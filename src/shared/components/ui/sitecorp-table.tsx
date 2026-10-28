import * as React from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table"
import { cn } from "@/lib/utils"

interface SiteCorpTableProps extends React.ComponentPropsWithoutRef<typeof Table> {
  columns: { header: string; accessor: string }[]
  data: Record<string, React.ReactNode>[]
}

const SiteCorpTable = React.forwardRef<
  HTMLTableElement,
  SiteCorpTableProps
>(({ columns, data, className, ...props }, ref) => {
  return (
    <div className="w-full overflow-auto">
      <Table ref={ref} className={cn("", className)}>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.accessor} className="text-ink font-semibold">
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, rowIndex) => (
            <TableRow key={rowIndex} className="hover:bg-muted/50">
              {columns.map((col) => (
                <TableCell key={col.accessor} className="text-foreground">
                  {row[col.accessor]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
})
SiteCorpTable.displayName = "SiteCorpTable"

export { SiteCorpTable }