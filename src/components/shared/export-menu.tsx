import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { downloadCSV, downloadXLSX, type ExportColumn } from '@/lib/export';

/** Exporta as linhas exibidas (já filtradas) em CSV ou Excel. */
export function ExportMenu<T>({ rows, columns, fileName, disabled }: { rows: T[]; columns: ExportColumn<T>[]; fileName: string; disabled?: boolean }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || rows.length === 0}>
          <Download /> Exportar
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => downloadCSV(rows, columns, fileName)}>
          <FileText /> CSV (Excel, Planilhas)
        </MenuItem>
        <MenuItem
          onSelect={() => {
            downloadXLSX(rows, columns, fileName).catch(() => toast.error('Não foi possível gerar o arquivo Excel. Tente o CSV.'));
          }}
        >
          <FileSpreadsheet /> Excel (.xlsx)
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
