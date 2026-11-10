import { describe, it, expect } from "vitest";
import {
  createSecretKey,
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
} from "node:crypto";
import { SignJWT, decodeProtectedHeader } from "jose";
import {
  createUserId,
  createEmail,
  TokenExpiredError,
  TokenInvalidError,
} from "../../src/domain";
import {
  Argon2idPasswordHasher,
  DUMMY_ARGON2ID_HASH,
  DUMMY_ARGON2ID_PREIMAGE,
  FakePasswordHasher,
  JoseTokenService,
  CryptoConfigurationError,
  generateEphemeralEd25519KeyPair,
  loadCryptoConfigFromEnv,
  validateArgon2idConfig,
  validateJwtServiceConfig,
} from "../../src/infrastructure";

describe("Fase 4G.1 & 4G.1.1 — Auditoría de Adaptadores Criptográficos Reales", () => {
  describe("1. Argon2idPasswordHasher y Auditoría de DUMMY_HASH (@node-rs/argon2)", () => {
    const hasher = new Argon2idPasswordHasher({
      memoryCostKiB: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    it("genera un PHC string Argon2id v=19 válido y verifica correctamente la contraseña original", async () => {
      const password = "C0ntr4s3n4!Segura_SiteCorp#2026";
      const phcHash = await hasher.hash(password);

      expect(phcHash).toMatch(
        /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/
      );

      const segments = phcHash.split("$");
      expect(segments.length).toBe(6);
      const saltBytes = Buffer.from(segments[4] ?? "", "base64");
      const digestBytes = Buffer.from(segments[5] ?? "", "base64");
      expect(saltBytes.byteLength).toBe(16);
      expect(digestBytes.byteLength).toBe(32);

      const isValid = await hasher.verify(password, phcHash);
      expect(isValid).toBe(true);
    });

    it("demuestra que DUMMY_ARGON2ID_HASH es un hash Argon2id real, válido, verificable y ejecuta el algoritmo ante claves erróneas", async () => {
      // 1. No requiere rehash bajo la configuración base (16 bytes de sal + 32 bytes de tag válidos)
      expect(hasher.needsRehash(DUMMY_ARGON2ID_HASH)).toBe(false);

      // 2. Es matemáticamente verificable con su preimagen centinela (no es un string ficticio con ceros)
      const verifiesSentinel = await hasher.verify(
        DUMMY_ARGON2ID_PREIMAGE,
        DUMMY_ARGON2ID_HASH
      );
      expect(verifiesSentinel).toBe(true);

      // 3. Una contraseña incorrecta contra DUMMY_ARGON2ID_HASH ejecuta realmente Argon2id y devuelve false
      const t0 = performance.now();
      const verifiesWrong = await hasher.verify(
        "IntentoDeAtaque#2026!",
        DUMMY_ARGON2ID_HASH
      );
      const elapsedDummyMs = performance.now() - t0;

      expect(verifiesWrong).toBe(false);
      // Un rechazo sintáctico inmediato tarda < 0.5ms; el cómputo real de 19 MiB / 2 iteraciones tarda varios ms
      expect(elapsedDummyMs).toBeGreaterThan(3);

      // 4. Si el hasher se calibra para el VPS con mayor coste (m=32768, t=3), adapta el hash dummy al nuevo coste
      const calibratedHasher = new Argon2idPasswordHasher({
        memoryCostKiB: 32768,
        timeCost: 3,
        parallelism: 1,
        outputLen: 32,
      });
      expect(calibratedHasher.needsRehash(DUMMY_ARGON2ID_HASH)).toBe(true);
      await expect(
        calibratedHasher.verify("IntentoDeAtaque#2026!", DUMMY_ARGON2ID_HASH)
      ).resolves.toBe(false);

      // 5. Compatibilidad total con FakePasswordHasher (retorna false sin lanzar error)
      const fakeHasher = new FakePasswordHasher();
      await expect(
        fakeHasher.verify("CualquierClave#2026!", DUMMY_ARGON2ID_HASH)
      ).resolves.toBe(false);
      await expect(
        fakeHasher.verify(DUMMY_ARGON2ID_PREIMAGE, DUMMY_ARGON2ID_HASH)
      ).resolves.toBe(false);
    });

    it("rechaza una contraseña incorrecta devolviendo false sin lanzar excepción", async () => {
      const phcHash = await hasher.hash("ClaveOriginal#2026_Valida!");
      const isValid = await hasher.verify("ClaveIncorrecta#2026_Valida!", phcHash);
      expect(isValid).toBe(false);
    });

    it("genera hashes y sales CSPRNG completamente distintos para la misma contraseña", async () => {
      const password = "MismaClave!PeroDistintaSal#2026";
      const [hashA, hashB] = await Promise.all([
        hasher.hash(password),
        hasher.hash(password),
      ]);

      expect(hashA).not.toBe(hashB);

      const saltA = hashA.split("$")[4];
      const saltB = hashB.split("$")[4];
      expect(saltA).not.toBe(saltB);

      expect(await hasher.verify(password, hashA)).toBe(true);
      expect(await hasher.verify(password, hashB)).toBe(true);
    });

    it("rechaza de forma segura hashes corruptos, vacíos, entradas no-string, sales cortas o parámetros fuera de cotas", async () => {
      const validPassword = "ClaveValida#SiteCorp2026!";

      await expect(hasher.verify(validPassword, "")).resolves.toBe(false);
      await expect(hasher.verify(validPassword, "not-a-phc-hash")).resolves.toBe(false);
      await expect(
        hasher.verify(validPassword, "$2b$12$abcdefghijklmnopqrstuv12345678901234567890")
      ).resolves.toBe(false);
      await expect(
        hasher.verify(
          validPassword,
          "$argon2i$v=19$m=19456,t=2,p=1$29RXI0hXtMDRMmbe3/7zdg$OvdMWPHapeufQQ7Uqsz2aYDyzKplvPMt3iAN8/1b/5w"
        )
      ).resolves.toBe(false);
      await expect(
        hasher.verify(validPassword, "$argon2id$v=19$m=19456,t=2,p=1$malformed")
      ).resolves.toBe(false);

      // Sal demasiado corta (< 16 bytes)
      await expect(
        hasher.verify(
          validPassword,
          "$argon2id$v=19$m=19456,t=2,p=1$c2hvcnRzYWx0$OvdMWPHapeufQQ7Uqsz2aYDyzKplvPMt3iAN8/1b/5w"
        )
      ).resolves.toBe(false);

      // Hash con coste de memoria malicioso fuera de límites (anti-DoS / OOM protection)
      await expect(
        hasher.verify(
          validPassword,
          "$argon2id$v=19$m=99999999,t=2,p=1$29RXI0hXtMDRMmbe3/7zdg$OvdMWPHapeufQQ7Uqsz2aYDyzKplvPMt3iAN8/1b/5w"
        )
      ).resolves.toBe(false);

      // Entradas malformadas en tiempo de ejecución (null/undefined forzados) no lanzan excepción
      await expect(
        hasher.verify(null as unknown as string, DUMMY_ARGON2ID_HASH)
      ).resolves.toBe(false);
      await expect(
        hasher.verify(validPassword, undefined as unknown as string)
      ).resolves.toBe(false);

      // Contraseña vacía o que excede maxPasswordBytes contra un hash válido ejecuta cómputo acotado y devuelve false
      const validHash = await hasher.hash(validPassword);
      await expect(hasher.verify("", validHash)).resolves.toBe(false);
      await expect(hasher.verify("A".repeat(300), validHash)).resolves.toBe(false);
    });

    it("detecta correctamente needsRehash() cuando cambian memoryCostKiB, timeCost, parallelism, outputLen o longitud de sal", async () => {
      const password = "ClaveRehash#SiteCorp2026!";
      const currentHash = await hasher.hash(password);

      expect(hasher.needsRehash(currentHash)).toBe(false);

      const upgradedMemoryHasher = new Argon2idPasswordHasher({
        memoryCostKiB: 32768,
        timeCost: 2,
        parallelism: 1,
        outputLen: 32,
      });
      expect(upgradedMemoryHasher.needsRehash(currentHash)).toBe(true);

      const upgradedTimeHasher = new Argon2idPasswordHasher({
        memoryCostKiB: 19456,
        timeCost: 3,
        parallelism: 1,
        outputLen: 32,
      });
      expect(upgradedTimeHasher.needsRehash(currentHash)).toBe(true);

      const upgradedOutputHasher = new Argon2idPasswordHasher({
        memoryCostKiB: 19456,
        timeCost: 2,
        parallelism: 1,
        outputLen: 64,
      });
      expect(upgradedOutputHasher.needsRehash(currentHash)).toBe(true);

      // Hash con sal de 19 bytes en vez de 16 bytes requiere rehash
      const nonStandardSaltHash =
        "$argon2id$v=19$m=19456,t=2,p=1$c2l0ZWNvcnBfZHVtbXlfc2FsdA$OvdMWPHapeufQQ7Uqsz2aYDyzKplvPMt3iAN8/1b/5w";
      expect(hasher.needsRehash(nonStandardSaltHash)).toBe(true);

      expect(hasher.needsRehash("")).toBe(true);
      expect(hasher.needsRehash("$fake_argon2id$v=19$abc")).toBe(true);
    });

    it("valida cotas de seguridad de configuración y nunca expone la contraseña en mensajes de error", async () => {
      expect(() => validateArgon2idConfig({ memoryCostKiB: 1024 })).toThrow(
        CryptoConfigurationError
      );
      expect(() => validateArgon2idConfig({ memoryCostKiB: 1048576 })).toThrow(
        CryptoConfigurationError
      );
      expect(() => validateArgon2idConfig({ timeCost: 0 })).toThrow(
        CryptoConfigurationError
      );
      expect(() => validateArgon2idConfig({ parallelism: 0 })).toThrow(
        CryptoConfigurationError
      );
      expect(() => validateArgon2idConfig({ outputLen: 8 })).toThrow(
        CryptoConfigurationError
      );

      await expect(hasher.hash("")).rejects.toThrow(CryptoConfigurationError);

      const oversizedSecret = `UltraSecret_${"X".repeat(200)}`;
      try {
        await hasher.hash(oversizedSecret);
        expect.unreachable("Debió lanzar CryptoConfigurationError");
      } catch (err) {
        expect(err).toBeInstanceOf(CryptoConfigurationError);
        expect((err as Error).message).not.toContain("UltraSecret_");
      }
    });
  });

  describe("2. JoseTokenService (Ed25519 / EdDSA JWT + Vinculación sid + CSPRNG Refresh Tokens)", () => {
    const activeKey = generateEphemeralEd25519KeyPair("ed25519-key-2026-q1", "test");
    const fixedNow = new Date("2026-05-10T12:00:00.000Z");

    const createTokenService = (
      now: Date = fixedNow,
      requireSessionId: boolean = false
    ) =>
      new JoseTokenService({
        issuer: "urn:sitecorp:auth-api",
        audience: "urn:sitecorp:api",
        accessTokenTtlSeconds: 900,
        requireSessionId,
        activeSigningKey: activeKey,
        nowProvider: () => now,
      });

    const sampleSub = createUserId(randomUUID());
    const sampleEmail = createEmail("operador@sitecorp.cu");
    const sampleSid = `sess_${randomUUID()}`;

    it("firma y verifica un Access Token Ed25519 válido vinculando inequívocamente sid, jti y todos los claims obligatorios", async () => {
      const service = createTokenService(fixedNow, true);

      const signed = await service.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "authenticated",
        scope: "api:full",
        sid: sampleSid,
      });

      expect(signed.tokenType).toBe("Bearer");
      expect(signed.expiresInSeconds).toBe(900);

      const header = decodeProtectedHeader(signed.token);
      expect(header.alg).toBe("EdDSA");
      expect(header.typ).toBe("JWT");
      expect(header.kid).toBe("ed25519-key-2026-q1");

      const verified = await service.verifyAccessToken(signed.token);
      const expectedIat = Math.floor(fixedNow.getTime() / 1000);

      expect(verified.sub).toBe(sampleSub);
      expect(verified.email).toBe(sampleEmail);
      expect(verified.role).toBe("authenticated");
      expect(verified.scope).toBe("api:full");
      expect(verified.sid).toBe(sampleSid);
      expect(verified.iss).toBe("urn:sitecorp:auth-api");
      expect(verified.aud).toBe("urn:sitecorp:api");
      expect(verified.iat).toBe(expectedIat);
      expect(verified.exp).toBe(expectedIat + 900);
      expect(typeof verified.jti).toBe("string");
      expect(verified.jti!.length).toBe(36);
    });

    it("valida el formato de sid y exige su presencia cuando requireSessionId está activo", async () => {
      const strictService = createTokenService(fixedNow, true);

      // Sin sid cuando requireSessionId=true -> rechaza al firmar
      await expect(
        strictService.signAccessToken({
          sub: sampleSub,
          email: sampleEmail,
          role: "authenticated",
        })
      ).rejects.toThrow(TokenInvalidError);

      // sid con formato malicioso o vacío -> rechaza al firmar
      await expect(
        strictService.signAccessToken({
          sub: sampleSub,
          email: sampleEmail,
          role: "authenticated",
          sid: "invalid_sid_without_prefix",
        })
      ).rejects.toThrow(TokenInvalidError);

      await expect(
        strictService.signAccessToken({
          sub: sampleSub,
          email: sampleEmail,
          role: "authenticated",
          sid: "sess_123; DROP TABLE sessions;",
        })
      ).rejects.toThrow(TokenInvalidError);

      // Token firmado sin sid por un servicio no estricto es rechazado por un verificador con requireSessionId=true
      const permissiveSigner = createTokenService(fixedNow, false);
      const { token: tokenWithoutSid } = await permissiveSigner.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "authenticated",
      });

      await expect(
        strictService.verifyAccessToken(tokenWithoutSid)
      ).rejects.toThrow(TokenInvalidError);
    });

    it("rechaza tokens con payload alterado (tampered payload / escalada de rol o cambio de sid)", async () => {
      const service = createTokenService();
      const { token } = await service.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "pending_password_change",
        scope: "auth:change_password",
        sid: sampleSid,
      });

      const [headerB64 = "", payloadB64 = "", signatureB64 = ""] = token.split(".");
      const decodedPayload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf8")
      ) as Record<string, unknown>;

      decodedPayload.role = "authenticated";
      decodedPayload.scope = "api:full";
      decodedPayload.sid = `sess_${randomUUID()}`;
      const tamperedPayloadB64 = Buffer.from(
        JSON.stringify(decodedPayload),
        "utf8"
      ).toString("base64url");

      const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${signatureB64}`;
      await expect(service.verifyAccessToken(tamperedToken)).rejects.toThrow(
        TokenInvalidError
      );
    });

    it("rechaza tokens con firma inválida o firmados por otra clave privada Ed25519", async () => {
      const service = createTokenService();
      const { token } = await service.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "authenticated",
        sid: sampleSid,
      });

      const parts = token.split(".");
      const sig = parts[2] ?? "";
      const mutatedSig = (sig.startsWith("A") ? "B" : "A") + sig.slice(1);
      const corruptedToken = `${parts[0] ?? ""}.${parts[1] ?? ""}.${mutatedSig}`;

      await expect(service.verifyAccessToken(corruptedToken)).rejects.toThrow(
        TokenInvalidError
      );

      const rogueKey = generateEphemeralEd25519KeyPair(
        "ed25519-key-2026-q1",
        "test"
      );
      const rogueService = new JoseTokenService({
        issuer: "urn:sitecorp:auth-api",
        audience: "urn:sitecorp:api",
        accessTokenTtlSeconds: 900,
        activeSigningKey: rogueKey,
        nowProvider: () => fixedNow,
      });

      const { token: rogueToken } = await rogueService.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "authenticated",
      });

      await expect(service.verifyAccessToken(rogueToken)).rejects.toThrow(
        TokenInvalidError
      );
    });

    it("rechaza algoritmo 'none' y ataques de confusión de algoritmo (HS256 firmado con la clave pública PEM)", async () => {
      const service = createTokenService();
      const nowSec = Math.floor(fixedNow.getTime() / 1000);

      const noneHeader = Buffer.from(
        JSON.stringify({ alg: "none", typ: "JWT", kid: activeKey.kid })
      ).toString("base64url");
      const nonePayload = Buffer.from(
        JSON.stringify({
          iss: "urn:sitecorp:auth-api",
          aud: "urn:sitecorp:api",
          sub: sampleSub,
          email: sampleEmail,
          role: "authenticated",
          scope: "api:full",
          sid: sampleSid,
          iat: nowSec,
          exp: nowSec + 900,
          jti: randomUUID(),
        })
      ).toString("base64url");

      await expect(
        service.verifyAccessToken(`${noneHeader}.${nonePayload}.`)
      ).rejects.toThrow(TokenInvalidError);
      await expect(
        service.verifyAccessToken(`${noneHeader}.${nonePayload}.fakesig`)
      ).rejects.toThrow(TokenInvalidError);

      const hmacKeyFromPublicPem = createSecretKey(
        Buffer.from(activeKey.publicKeyPem, "utf8")
      );
      const confusedToken = await new SignJWT({
        email: sampleEmail,
        role: "authenticated",
        scope: "api:full",
        sid: sampleSid,
      })
        .setProtectedHeader({
          alg: "HS256",
          typ: "JWT",
          kid: activeKey.kid,
        })
        .setIssuer("urn:sitecorp:auth-api")
        .setAudience("urn:sitecorp:api")
        .setSubject(sampleSub)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 900)
        .setJti(randomUUID())
        .sign(hmacKeyFromPublicPem);

      await expect(service.verifyAccessToken(confusedToken)).rejects.toThrow(
        TokenInvalidError
      );
    });

    it("rechaza emisor (iss) incorrecto, audiencia (aud) incorrecta, tokens expirados y tokens con TTL excesivo", async () => {
      const service = createTokenService();

      const wrongIssuerService = new JoseTokenService({
        issuer: "urn:external:attacker",
        audience: "urn:sitecorp:api",
        accessTokenTtlSeconds: 900,
        activeSigningKey: activeKey,
        nowProvider: () => fixedNow,
      });
      const { token: wrongIssToken } = await wrongIssuerService.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "authenticated",
      });
      await expect(service.verifyAccessToken(wrongIssToken)).rejects.toThrow(
        TokenInvalidError
      );

      const wrongAudienceService = new JoseTokenService({
        issuer: "urn:sitecorp:auth-api",
        audience: "urn:other-service:api",
        accessTokenTtlSeconds: 900,
        activeSigningKey: activeKey,
        nowProvider: () => fixedNow,
      });
      const { token: wrongAudToken } = await wrongAudienceService.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "authenticated",
      });
      await expect(service.verifyAccessToken(wrongAudToken)).rejects.toThrow(
        TokenInvalidError
      );

      const { token: validToken } = await service.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "authenticated",
      });
      const futureTime = new Date(fixedNow.getTime() + 901 * 1000);
      const futureVerifier = createTokenService(futureTime);

      await expect(futureVerifier.verifyAccessToken(validToken)).rejects.toThrow(
        TokenExpiredError
      );

      const pastVerifier = createTokenService(
        new Date(fixedNow.getTime() - 120 * 1000)
      );
      await expect(pastVerifier.verifyAccessToken(validToken)).rejects.toThrow(
        TokenInvalidError
      );

      // Token con exp - iat superior al accessTokenTtlSeconds permitido por el verificador
      const longLivedSigner = new JoseTokenService({
        issuer: "urn:sitecorp:auth-api",
        audience: "urn:sitecorp:api",
        accessTokenTtlSeconds: 3600,
        activeSigningKey: activeKey,
        nowProvider: () => fixedNow,
      });
      const { token: excessiveTtlToken } =
        await longLivedSigner.signAccessToken({
          sub: sampleSub,
          email: sampleEmail,
          role: "authenticated",
        });
      await expect(service.verifyAccessToken(excessiveTtlToken)).rejects.toThrow(
        TokenInvalidError
      );
    });

    it("soporta rotación de claves mediante kid (clave activa v2 + clave pública retirada v1 en additionalVerificationKeys)", async () => {
      const keyV1 = generateEphemeralEd25519KeyPair("ed25519-key-v1", "test");
      const keyV2 = generateEphemeralEd25519KeyPair("ed25519-key-v2", "test");

      const serviceBeforeRotation = new JoseTokenService({
        issuer: "urn:sitecorp:auth-api",
        audience: "urn:sitecorp:api",
        accessTokenTtlSeconds: 900,
        activeSigningKey: keyV1,
        nowProvider: () => fixedNow,
      });

      const { token: tokenSignedWithV1 } =
        await serviceBeforeRotation.signAccessToken({
          sub: sampleSub,
          email: sampleEmail,
          role: "authenticated",
          sid: sampleSid,
        });

      const serviceDuringRotation = new JoseTokenService({
        issuer: "urn:sitecorp:auth-api",
        audience: "urn:sitecorp:api",
        accessTokenTtlSeconds: 900,
        activeSigningKey: keyV2,
        additionalVerificationKeys: [
          { kid: keyV1.kid, publicKeyPem: keyV1.publicKeyPem },
        ],
        nowProvider: () => fixedNow,
      });

      const { token: tokenSignedWithV2 } =
        await serviceDuringRotation.signAccessToken({
          sub: sampleSub,
          email: sampleEmail,
          role: "authenticated",
          sid: sampleSid,
        });

      expect(decodeProtectedHeader(tokenSignedWithV2).kid).toBe("ed25519-key-v2");

      const verifiedV1 = await serviceDuringRotation.verifyAccessToken(
        tokenSignedWithV1
      );
      const verifiedV2 = await serviceDuringRotation.verifyAccessToken(
        tokenSignedWithV2
      );
      expect(verifiedV1.sub).toBe(sampleSub);
      expect(verifiedV1.sid).toBe(sampleSid);
      expect(verifiedV2.sub).toBe(sampleSub);
      expect(verifiedV2.sid).toBe(sampleSid);

      const serviceAfterRetirement = new JoseTokenService({
        issuer: "urn:sitecorp:auth-api",
        audience: "urn:sitecorp:api",
        accessTokenTtlSeconds: 900,
        activeSigningKey: keyV2,
        nowProvider: () => fixedNow,
      });

      await expect(
        serviceAfterRetirement.verifyAccessToken(tokenSignedWithV1)
      ).rejects.toThrow(TokenInvalidError);
    });

    it("rechaza tokens sin claims obligatorios (jti, typ, email, role, sub) y descarta privilegios arbitrarios al firmar", async () => {
      const service = createTokenService();
      const nowSec = Math.floor(fixedNow.getTime() / 1000);
      const privKey = createPrivateKey({
        key: activeKey.privateKeyPem,
        format: "pem",
        type: "pkcs8",
      });

      // Token sin `jti`
      const tokenWithoutJti = await new SignJWT({
        email: sampleEmail,
        role: "authenticated",
        scope: "api:full",
      })
        .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: activeKey.kid })
        .setIssuer("urn:sitecorp:auth-api")
        .setAudience("urn:sitecorp:api")
        .setSubject(sampleSub)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 900)
        .sign(privKey);

      await expect(service.verifyAccessToken(tokenWithoutJti)).rejects.toThrow(
        TokenInvalidError
      );

      // Token sin `typ: "JWT"` en la cabecera protegida
      const tokenWithoutTyp = await new SignJWT({
        email: sampleEmail,
        role: "authenticated",
        scope: "api:full",
      })
        .setProtectedHeader({ alg: "EdDSA", kid: activeKey.kid })
        .setIssuer("urn:sitecorp:auth-api")
        .setAudience("urn:sitecorp:api")
        .setSubject(sampleSub)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 900)
        .setJti(randomUUID())
        .sign(privKey);

      await expect(service.verifyAccessToken(tokenWithoutTyp)).rejects.toThrow(
        TokenInvalidError
      );

      // Token con sid adulterado dentro de un JWT firmado
      const tokenWithBadSid = await new SignJWT({
        email: sampleEmail,
        role: "authenticated",
        scope: "api:full",
        sid: "bad_sid_value",
      })
        .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: activeKey.kid })
        .setIssuer("urn:sitecorp:auth-api")
        .setAudience("urn:sitecorp:api")
        .setSubject(sampleSub)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 900)
        .setJti(randomUUID())
        .sign(privKey);

      await expect(service.verifyAccessToken(tokenWithBadSid)).rejects.toThrow(
        TokenInvalidError
      );

      // Al firmar, cualquier propiedad arbitraria inyectada es ignorada
      const signed = await service.signAccessToken({
        sub: sampleSub,
        email: sampleEmail,
        role: "authenticated",
        sid: sampleSid,
        isAdmin: true,
        permissions: ["admin:delete_all"],
      });

      const verified = await service.verifyAccessToken(signed.token);
      expect(verified.isAdmin).toBeUndefined();
      expect(verified.permissions).toBeUndefined();
      expect(verified.sid).toBe(sampleSid);

      await expect(
        service.signAccessToken({
          sub: sampleSub,
          email: sampleEmail,
          role: "pending_password_change",
          scope: "api:full",
        })
      ).rejects.toThrow(TokenInvalidError);
    });

    it("genera Refresh Tokens opacos con 256 bits CSPRNG y rechaza de forma controlada tokens malformados", () => {
      const service = createTokenService();
      const tokenA = service.generateOpaqueToken();
      const tokenB = service.generateOpaqueToken();

      expect(tokenA.rawToken).not.toBe(tokenB.rawToken);
      expect(tokenA.tokenHash).not.toBe(tokenB.tokenHash);

      expect(tokenA.rawToken).toMatch(/^sct_[A-Za-z0-9_-]{43}$/);
      const rawEntropyBytes = Buffer.from(
        tokenA.rawToken.slice("sct_".length),
        "base64url"
      );
      expect(rawEntropyBytes.byteLength).toBe(32);

      expect(tokenA.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(service.hashOpaqueToken(tokenA.rawToken)).toBe(tokenA.tokenHash);

      expect(
        service.verifyOpaqueTokenHash(tokenA.rawToken, tokenA.tokenHash)
      ).toBe(true);
      expect(
        service.verifyOpaqueTokenHash(tokenB.rawToken, tokenA.tokenHash)
      ).toBe(false);

      // Rechazo controlado de refresh tokens malformados en hashOpaqueToken y verifyOpaqueTokenHash
      const malformedTokens = [
        "",
        "   ",
        "not_a_token",
        "sct_too_short",
        `sct_${"A".repeat(42)}`,
        `sct_${"A".repeat(44)}`,
        `sct_${"A".repeat(42)}!`,
        ` ${tokenA.rawToken} `,
      ];

      for (const badToken of malformedTokens) {
        expect(() => service.hashOpaqueToken(badToken)).toThrow(
          TokenInvalidError
        );
        expect(service.verifyOpaqueTokenHash(badToken, tokenA.tokenHash)).toBe(
          false
        );
      }
    });
  });

  describe("3. Configuración Criptográfica, Entornos y Protección de Claves", () => {
    it("bloquea la generación de claves efímeras en producción y ante entornos desconocidos (fail-closed)", () => {
      expect(() =>
        generateEphemeralEd25519KeyPair("prod-key", "production")
      ).toThrow(CryptoConfigurationError);
      expect(() =>
        generateEphemeralEd25519KeyPair("prod-key", "PRODUCTION")
      ).toThrow(CryptoConfigurationError);
      expect(() =>
        generateEphemeralEd25519KeyPair("prod-key", "staging")
      ).toThrow(CryptoConfigurationError);
      expect(() => generateEphemeralEd25519KeyPair("prod-key", "")).toThrow(
        CryptoConfigurationError
      );
    });

    it("rechaza claves no-Ed25519 (RSA), pares desemparejados y claves públicas duplicadas en el llavero", () => {
      const keyA = generateEphemeralEd25519KeyPair("key-a", "test");
      const keyB = generateEphemeralEd25519KeyPair("key-b", "test");

      expect(() =>
        validateJwtServiceConfig({
          issuer: "urn:sitecorp:auth-api",
          audience: "urn:sitecorp:api",
          accessTokenTtlSeconds: 900,
          activeSigningKey: {
            kid: "mismatched-key",
            privateKeyPem: keyA.privateKeyPem,
            publicKeyPem: keyB.publicKeyPem,
          },
        })
      ).toThrow(CryptoConfigurationError);

      // Misma clave pública registrada bajo dos kids distintos
      expect(() =>
        validateJwtServiceConfig({
          issuer: "urn:sitecorp:auth-api",
          audience: "urn:sitecorp:api",
          accessTokenTtlSeconds: 900,
          activeSigningKey: keyA,
          additionalVerificationKeys: [
            { kid: "key-b-duplicate-pub", publicKeyPem: keyA.publicKeyPem },
          ],
        })
      ).toThrow(CryptoConfigurationError);

      const rsaPair = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      expect(() =>
        validateJwtServiceConfig({
          issuer: "urn:sitecorp:auth-api",
          audience: "urn:sitecorp:api",
          accessTokenTtlSeconds: 900,
          activeSigningKey: {
            kid: "rsa-key",
            privateKeyPem: rsaPair.privateKey,
            publicKeyPem: rsaPair.publicKey,
          },
        })
      ).toThrow(CryptoConfigurationError);
    });

    it("valida configuración de producción incompleta y nunca filtra claves privadas en errores", () => {
      const ephemeral = generateEphemeralEd25519KeyPair("env-kid-1", "test");
      const config = loadCryptoConfigFromEnv({
        SITECORP_AUTH_ENV: "production",
        SITECORP_JWT_ISSUER: "urn:sitecorp:auth-api",
        SITECORP_JWT_AUDIENCE: "urn:sitecorp:api",
        SITECORP_JWT_ACCESS_TTL_SECONDS: "600",
        SITECORP_JWT_ACTIVE_KID: ephemeral.kid,
        SITECORP_JWT_PRIVATE_KEY_PEM: ephemeral.privateKeyPem.replace(/\n/g, "\\n"),
        SITECORP_JWT_PUBLIC_KEY_PEM: ephemeral.publicKeyPem.replace(/\n/g, "\\n"),
        SITECORP_ARGON2_MEMORY_KIB: "19456",
        SITECORP_ARGON2_TIME_COST: "2",
        SITECORP_ARGON2_PARALLELISM: "1",
      });

      expect(config.environment).toBe("production");
      expect(config.jwt.accessTokenTtlSeconds).toBe(600);
      expect(config.jwt.requireSessionId).toBe(true);
      expect(config.jwt.activeSigningKey.kid).toBe("env-kid-1");

      // En producción no se permite desactivar SITECORP_JWT_REQUIRE_SESSION_ID
      expect(() =>
        loadCryptoConfigFromEnv({
          SITECORP_AUTH_ENV: "production",
          SITECORP_JWT_ISSUER: "urn:sitecorp:auth-api",
          SITECORP_JWT_AUDIENCE: "urn:sitecorp:api",
          SITECORP_JWT_REQUIRE_SESSION_ID: "false",
          SITECORP_JWT_ACTIVE_KID: ephemeral.kid,
          SITECORP_JWT_PRIVATE_KEY_PEM: ephemeral.privateKeyPem,
          SITECORP_JWT_PUBLIC_KEY_PEM: ephemeral.publicKeyPem,
        })
      ).toThrow(CryptoConfigurationError);

      // Rechaza entorno desconocido (fail-closed)
      expect(() =>
        loadCryptoConfigFromEnv({
          SITECORP_AUTH_ENV: "prod_typo",
        })
      ).toThrow(CryptoConfigurationError);

      // Rechaza producción sin claves o sin issuer explícito
      expect(() =>
        loadCryptoConfigFromEnv({
          SITECORP_AUTH_ENV: "production",
          SITECORP_JWT_AUDIENCE: "urn:sitecorp:api",
          SITECORP_JWT_ACTIVE_KID: ephemeral.kid,
          SITECORP_JWT_PRIVATE_KEY_PEM: ephemeral.privateKeyPem,
          SITECORP_JWT_PUBLIC_KEY_PEM: ephemeral.publicKeyPem,
        })
      ).toThrow(CryptoConfigurationError);

      // Verificar que una clave privada corrupta nunca se expone en el mensaje de error
      const corruptedPrivatePem =
        "-----BEGIN PRIVATE KEY-----\nSUPER_SECRET_KEY_MATERIAL_DO_NOT_LEAK\n-----END PRIVATE KEY-----";
      try {
        validateJwtServiceConfig({
          issuer: "urn:sitecorp:auth-api",
          audience: "urn:sitecorp:api",
          accessTokenTtlSeconds: 900,
          activeSigningKey: {
            kid: "corrupted-key",
            privateKeyPem: corruptedPrivatePem,
            publicKeyPem: ephemeral.publicKeyPem,
          },
        });
        expect.unreachable("Debió lanzar CryptoConfigurationError");
      } catch (err) {
        expect(err).toBeInstanceOf(CryptoConfigurationError);
        expect((err as Error).message).not.toContain(
          "SUPER_SECRET_KEY_MATERIAL_DO_NOT_LEAK"
        );
      }
    });
  });
});
