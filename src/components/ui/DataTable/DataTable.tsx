import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/ui/cn";

export type DataTableColumn = {
  id: string;
  header: ReactNode;
  /** Name shown beside the cell when the row stacks. Defaults to a string header. */
  label?: string;
  className?: string;
};

export type DataTableRow = {
  id: string;
  cells: ReactNode[];
} & Omit<HTMLAttributes<HTMLTableRowElement>, "id" | "children">;

function columnLabel(column: DataTableColumn) {
  if (column.label) return column.label;
  return typeof column.header === "string" ? column.header : undefined;
}

/**
 * A table that stays a table while its container is wide, and stacks each row
 * into a labeled card when the container is narrow.
 */
export function DataTable({
  label,
  columns,
  rows,
  className,
}: {
  label: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  className?: string;
}) {
  return (
    <div className={cn("sl-data-table", className)}>
      <table>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={column.className}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, cells, className: rowClass, ...rowProps }) => (
            <tr key={id} className={rowClass} {...rowProps}>
              {columns.map((column, index) => (
                <td key={column.id} className={column.className} data-label={columnLabel(column)}>
                  <span className="sl-data-table-value">{cells[index]}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
