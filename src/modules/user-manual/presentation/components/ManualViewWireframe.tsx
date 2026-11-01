import * as React from "react"
import { type ManualSection } from "../../domain/manual-data"
import { Badge } from "@/shared/components/ui/badge"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { Maximize2, Camera } from "lucide-react"
import { cn } from "@/lib/utils"

interface ManualViewWireframeProps {
  section: ManualSection
  className?: string
}

export const ManualViewWireframe: React.FC<ManualViewWireframeProps> = ({ section, className }) => {
  const { mockup, realImagePath } = section
  const [modalOpen, setModalOpen] = React.useState(false)

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden text-slate-800",
        className
      )}
    >
      {/* Top simulated window bar */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100/90 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-400/90 inline-block" />
            <span className="h-3 w-3 rounded-full bg-amber-400/90 inline-block" />
            <span className="h-3 w-3 rounded-full bg-emerald-400/90 inline-block" />
          </div>
          <span className="ml-2 text-xs font-semibold text-slate-700">
            SiteCorp ERP · {section.route || "Plataforma"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {realImagePath ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
              <Camera className="h-3 w-3" />
              Captura Real del Sistema
            </span>
          ) : (
            <span className="text-[11px] font-mono text-slate-400">Esquema Visual de Interfaz</span>
          )}

          {realImagePath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModalOpen(true)}
              className="h-6 px-1.5 text-xs text-slate-600 hover:text-slate-900"
              title="Ampliar captura"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Si hay captura real, la mostramos en alta fidelidad */}
      {realImagePath ? (
        <div className="relative group bg-slate-900/5 p-2 sm:p-4 flex items-center justify-center overflow-hidden">
          <div className="relative rounded-lg overflow-hidden border border-slate-200 shadow-xs max-h-[460px] w-full flex items-center justify-center bg-white">
            <img
              src={realImagePath}
              alt={section.title}
              className="w-full h-auto object-contain max-h-[440px] cursor-pointer hover:opacity-95 transition-opacity"
              onClick={() => setModalOpen(true)}
            />
            <div
              onClick={() => setModalOpen(true)}
              className="absolute inset-0 bg-slate-900/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
            >
              <span className="bg-white/95 text-slate-800 text-xs font-medium px-3 py-1.5 rounded-full shadow-md flex items-center gap-1.5">
                <Maximize2 className="h-3.5 w-3.5" />
                Hacer clic para ampliar
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* Main simulated workspace para vistas donde aún no se ha subido captura */
        <div className="p-5 space-y-4 bg-slate-50/50">
          {/* Header inside mockup */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-base font-semibold text-slate-900">{mockup.headerTitle}</h4>
                {mockup.badges.map((badge, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10"
                  >
                    {badge}
                  </span>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{mockup.headerSubtitle}</p>
            </div>

            {mockup.actionButtons && mockup.actionButtons.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {mockup.actionButtons.map((btn, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={cn(
                      "text-xs px-2.5 py-1.5 rounded-md font-medium transition-colors shadow-xs",
                      idx === 0
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    {btn}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tabs if present */}
          {mockup.tabs && mockup.tabs.length > 0 && (
            <div className="flex items-center gap-1.5 border-b border-slate-200 pb-2 overflow-x-auto">
              {mockup.tabs.map((tab, idx) => (
                <span
                  key={idx}
                  className={cn(
                    "text-xs px-3 py-1 rounded-md font-medium whitespace-nowrap",
                    idx === 0
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  {tab}
                </span>
              ))}
            </div>
          )}

          {/* KPIs cards if present */}
          {mockup.kpis && mockup.kpis.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {mockup.kpis.map((kpi, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs"
                >
                  <div className="text-[11px] font-medium text-slate-500 truncate">{kpi.label}</div>
                  <div
                    className={cn(
                      "text-lg font-bold mt-0.5",
                      kpi.color === "danger" && "text-red-600",
                      kpi.color === "warning" && "text-amber-600",
                      kpi.color === "success" && "text-emerald-600",
                      (!kpi.color || kpi.color === "default") && "text-slate-900"
                    )}
                  >
                    {kpi.value}
                  </div>
                  {kpi.trend && (
                    <div className="text-[10px] text-slate-400 mt-0.5">{kpi.trend}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Simulated Table */}
          {mockup.tableColumns && mockup.tableRows && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    {mockup.tableColumns.map((col, idx) => (
                      <th key={idx} className="px-3.5 py-2">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mockup.tableRows.map((row, ridx) => (
                    <tr key={ridx} className="hover:bg-slate-50/60 transition-colors">
                      {mockup.tableColumns!.map((col, cidx) => (
                        <td key={cidx} className="px-3.5 py-2 text-slate-700 whitespace-nowrap">
                          {row[col] || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Notes if present */}
          {mockup.notes && (
            <div className="rounded-md bg-blue-50/60 border border-blue-100 p-2.5 text-[11px] text-blue-800 flex items-center gap-2">
              <span className="font-semibold">Nota técnica:</span> {mockup.notes}
            </div>
          )}
        </div>
      )}

      {/* Modal para ampliar captura de pantalla real */}
      {realImagePath && (
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="max-w-5xl p-2 bg-slate-900 border-slate-800 text-white">
            <DialogHeader className="p-3 border-b border-slate-800">
              <DialogTitle className="text-sm font-semibold flex items-center gap-2 text-slate-200">
                <Camera className="h-4 w-4 text-emerald-400" />
                Captura Real · {section.title} ({section.route})
              </DialogTitle>
            </DialogHeader>
            <div className="p-2 overflow-auto max-h-[80vh] flex items-center justify-center">
              <img
                src={realImagePath}
                alt={section.title}
                className="w-full h-auto rounded-md shadow-2xl object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
