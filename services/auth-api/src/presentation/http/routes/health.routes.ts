import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ReadinessProbe } from "../types";

export interface HealthRoutesOptions {
  readonly readinessTimeoutMs: number;
  readonly isShuttingDown: () => boolean;
  readonly databaseReadinessCheck?: ReadinessProbe;
  readonly cryptoReadinessCheck?: ReadinessProbe;
  readonly nowProvider?: () => Date;
}

async function runProbeWithTimeout(
  probe: ReadinessProbe | undefined,
  timeoutMs: number
): Promise<boolean> {
  if (!probe) {
    return true;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const probeResult = await Promise.race([
      probe().catch(() => false),
      timeoutPromise,
    ]);
    return Boolean(probeResult);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Registra los endpoints de salud del proceso:
 * - `GET /health/live`: Liveness check ligero en memoria sin consultar dependencias externas.
 * - `GET /health/ready`: Readiness check con sondas inyectables acotadas por timeout
 *   para comprobar PostgreSQL y configuración criptográfica sin filtrar detalles internos.
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRoutesOptions
): void {
  const nowProvider = options.nowProvider ?? (() => new Date());

  app.get("/health/live", async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      data: {
        status: "ok",
      },
      meta: {
        requestId: req.id,
        timestamp: nowProvider().toISOString(),
      },
    });
  });

  app.get("/health/ready", async (req: FastifyRequest, reply: FastifyReply) => {
    if (options.isShuttingDown()) {
      return reply.code(503).send({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "El servicio se encuentra en proceso de apagado y no acepta nuevo tráfico.",
          requestId: req.id,
          details: {
            status: "not_ready",
          },
        },
      });
    }

    const [dbReady, cryptoReady] = await Promise.all([
      runProbeWithTimeout(
        options.databaseReadinessCheck,
        options.readinessTimeoutMs
      ),
      runProbeWithTimeout(
        options.cryptoReadinessCheck,
        options.readinessTimeoutMs
      ),
    ]);

    if (!dbReady || !cryptoReady) {
      return reply.code(503).send({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "El servicio aún no se encuentra listo para recibir tráfico.",
          requestId: req.id,
          details: {
            status: "not_ready",
          },
        },
      });
    }

    return reply.code(200).send({
      data: {
        status: "ready",
      },
      meta: {
        requestId: req.id,
        timestamp: nowProvider().toISOString(),
      },
    });
  });
}
