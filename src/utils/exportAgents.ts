import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ScheduleData, Status, ManpowerAllocation, Project, DynamicColumn } from '../state/types';
import { getWeek, getDayAbbr, formatDate, getDateRangeOfWeek, isBrazilianHoliday, getRoleAbbreviation, getWeekYear } from './dataUtils';
import { STATUS_COLOR_MAP } from '../state/types';

import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
// Removed 'import { utils, writeFile } from 'xlsx';' using grep later, simply replacing the function here

const stripHtmlTags = (str: string | undefined | null) => {
    if (!str) return '';
    
    let html = str;
    // Replace typical block-level transitions and line breaks with newline characters
    html = html.replace(/<br\s*\/?>/gi, '\n');
    html = html.replace(/<\/div>\s*<div[^>]*>/gi, '\n');
    html = html.replace(/<\/p>\s*<p[^>]*>/gi, '\n');
    html = html.replace(/<\/div>/gi, '\n');
    html = html.replace(/<\/p>/gi, '\n');

    const temp = document.createElement('div');
    temp.innerHTML = html;
    let text = temp.textContent || temp.innerText || '';
    
    // Sanitize trailing/leading newlines and excess whitespace
    return text.replace(/\n\s*\n/g, '\n').trim();
};

export const exportToExcelAgent = async (
    filteredData: ScheduleData, 
    dates: Date[], 
    activeProject: Project,
    dynamicColumns: DynamicColumn[],
    visibleColumns?: Record<string, boolean>
) => {
    if (filteredData.length === 0) {
        return;
    }

    const title = activeProject.title;
    
    // Filter dynamic columns by visibility AND data
    const visibleDynamicColsMapping = dynamicColumns.map(col => {
        const hasData = filteredData.some(g => g.customValues?.[col.id] && g.customValues[col.id].trim() !== '');
        const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
        return { id: col.id, label: col.name, width: 25, hasData, isVisible };
    }).filter(c => c.hasData && c.isVisible);

    const showID = visibleColumns ? visibleColumns['ID'] !== false : true;
    const showTask = visibleColumns ? visibleColumns['TAREFA PRINCIPAL'] !== false : true;
    const showActivity = visibleColumns ? visibleColumns['ATIVIDADE'] !== false : true;
    const showSector = visibleColumns ? visibleColumns['SETOR'] !== false : true;

    const baseCols = (showID ? 1 : 0) + visibleDynamicColsMapping.length + (showTask ? 1 : 0) + (showActivity ? 1 : 0) + (showSector ? 1 : 0);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cronograma');

    // 1. Build Headers
    const firstWeek = dates.length > 0 ? getWeek(dates[0]) : '';
    const lastWeek = dates.length > 0 ? getWeek(dates[dates.length - 1]) : '';
    const weekRange = firstWeek === lastWeek ? `${firstWeek}` : `${firstWeek}@${lastWeek}`;

    const titleRow = Array(baseCols + dates.length).fill('');
    titleRow[0] = `PROGRAMAÇÃO SEMANAL -${weekRange}\n${title.toUpperCase()}`;
    worksheet.addRow(titleRow);
    worksheet.addRow(Array(baseCols + dates.length).fill(''));
    // Merge cell for the title spanning all columns
    worksheet.mergeCells(1, 1, 2, baseCols + dates.length);

    const weekHeadersRow: string[] = Array(baseCols).fill('');
    if (baseCols > 1) {
        weekHeadersRow[0] = `Elaborado por: ${activeProject.programmerName || ''}`;
        weekHeadersRow[baseCols - 1] = `Atualizado em: ${new Date(activeProject.lastModified).toLocaleDateString('pt-BR')}`;
    } else if (baseCols === 1) {
        weekHeadersRow[0] = `Elaborado por: ${activeProject.programmerName || ''} | Atualizado em: ${new Date(activeProject.lastModified).toLocaleDateString('pt-BR')}`;
    }

    const dayNameHeadersRow: string[] = [];
    if (showID) dayNameHeadersRow.push('ID');
    visibleDynamicColsMapping.forEach(c => dayNameHeadersRow.push(c.label.toUpperCase()));
    if (showTask) dayNameHeadersRow.push('TAREFA PRINCIPAL');
    if (showActivity) dayNameHeadersRow.push('ATIVIDADE');
    if (showSector) dayNameHeadersRow.push('SETOR');
    const dayNumHeadersRow: string[] = Array(baseCols).fill('');

    const dateHeaders = dates.map(d => ({
        week: `Semana ${getWeek(d)}`,
        dayName: getDayAbbr(d),
        dayNum: d.getUTCDate(),
        isWeekend: getDayAbbr(d) === 'SÁB' || getDayAbbr(d) === 'DOM'
    }));

    dateHeaders.forEach(h => {
        weekHeadersRow.push(h.week);
        dayNameHeadersRow.push(h.dayName);
        dayNumHeadersRow.push(h.dayNum.toString());
    });

    worksheet.addRow(weekHeadersRow);
    worksheet.addRow(dayNameHeadersRow);
    worksheet.addRow(dayNumHeadersRow);

    // Merge Elaborado por...
    if (baseCols > 1) {
        worksheet.mergeCells(3, 1, 3, baseCols - 1);
    }

    // Merge Week Headers
    let currentWeek = '';
    let weekColStart = baseCols + 1;
    dateHeaders.forEach((h, i) => {
        const colIndex = baseCols + 1 + i;
        if (h.week !== currentWeek) {
            if (currentWeek) {
                worksheet.mergeCells(3, weekColStart, 3, colIndex - 1);
            }
            currentWeek = h.week;
            weekColStart = colIndex;
        }
    });
    if (currentWeek) {
        worksheet.mergeCells(3, weekColStart, 3, baseCols + dateHeaders.length);
    }

    // Merge Fixed Columns Vertically
    for (let c = 1; c <= baseCols; c++) {
        worksheet.mergeCells(4, c, 5, c);
    }

    // 2. Build Body
    let currentRow = 6;
    let wbsGroup = 1;

    filteredData.forEach(group => {
        const groupStartRow = currentRow;
        let groupRowSpan = group.tarefas.reduce((acc, t) => acc + (t.activities.length > 0 ? t.activities.length : 1), 0);
        let wbsTask = 1;

        group.tarefas.forEach(task => {
            const taskStartRow = currentRow;
            const taskRowSpan = task.activities.length > 0 ? task.activities.length : 1;
            let wbsActivity = 1;

            const activities = task.activities.length > 0 ? task.activities : [{ id: `empty-${task.id}`, name: '', schedule: {} }];
            activities.forEach(activity => {
                const rowData: any[] = [];
                if (showID) {
                    rowData.push(`${wbsGroup}.${wbsTask}.${wbsActivity}`);
                }
                
                visibleDynamicColsMapping.forEach(col => {
                    rowData.push(stripHtmlTags(group.customValues?.[col.id]));
                });
                
                if (showTask) {
                    const cleanTitle = stripHtmlTags(task.title);
                    const cleanFa = stripHtmlTags(task.fa || '');
                    const taskText = cleanFa && cleanFa !== 'Nº FA' ? `${cleanTitle}\n${cleanFa}` : cleanTitle;
                    rowData.push(taskText);
                }
                if (showActivity) rowData.push(stripHtmlTags(activity.name));
                if (showSector) rowData.push(stripHtmlTags(activity.sector || ''));
                
                dates.forEach(date => {
                    const status = activity.schedule[formatDate(date)];
                    rowData.push(status || '');
                });
                
                worksheet.addRow(rowData);
                currentRow++;
                wbsActivity++;
            });

            // Merge Tarefa Principal
            if (showTask && taskRowSpan > 1) {
                const tpColIndex = (showID ? 1 : 0) + visibleDynamicColsMapping.length + 1;
                worksheet.mergeCells(taskStartRow, tpColIndex, taskStartRow + taskRowSpan - 1, tpColIndex);
            }
            wbsTask++;
        });

        // Merge ID and Group Dynamic Cols
        if (groupRowSpan > 1) {
            if (showID) {
                worksheet.mergeCells(groupStartRow, 1, groupStartRow + groupRowSpan - 1, 1);
            }
            
            visibleDynamicColsMapping.forEach((_, idx) => {
                const colIdx = (showID ? 1 : 0) + 1 + idx;
                worksheet.mergeCells(groupStartRow, colIdx, groupStartRow + groupRowSpan - 1, colIdx);
            });
        }
        wbsGroup++;
    });

    // 2.5 Add Summary Rows Below Schedule
    const lastDataRow = currentRow - 1;
    
    // Add 2 spacing rows
    worksheet.addRow([]);
    worksheet.addRow([]);
    
    const summaryStartRow = lastDataRow + 3;
    const rowX = summaryStartRow + 1;
    const rowOk = summaryStartRow + 2;
    const rowN = summaryStartRow + 3;
    const rowC = summaryStartRow + 4;
    const rowTotal = summaryStartRow + 5;
    const rowPctX = summaryStartRow + 6;
    const rowPctOk = summaryStartRow + 7;
    const rowPctN = summaryStartRow + 8;
    const rowPctC = summaryStartRow + 9;

    // Header row
    const headerRowData = Array(baseCols + dates.length).fill('');
    headerRowData[0] = 'INDICADORES DE PROGRAMAÇÃO E STATUS';
    worksheet.addRow(headerRowData);
    worksheet.mergeCells(summaryStartRow, 1, summaryStartRow, baseCols);

    const rowLabels = {
        [rowX]: 'Total Programado (X)',
        [rowOk]: 'Total Realizado (Ok)',
        [rowN]: 'Total Não Realizado (N)',
        [rowC]: 'Total Cancelado (C)',
        [rowTotal]: 'Total de Atividades',
        [rowPctX]: '% Programado (X)',
        [rowPctOk]: '% Realizado (Ok)',
        [rowPctN]: '% Não Realizado (N)',
        [rowPctC]: '% Cancelado (C)'
    };

    Object.entries(rowLabels).forEach(([rowNumStr, label]) => {
        const rowNum = parseInt(rowNumStr);
        const rData = Array(baseCols + dates.length).fill('');
        rData[0] = label;
        worksheet.addRow(rData);
        worksheet.mergeCells(rowNum, 1, rowNum, baseCols);
    });

    const getColLetter = (col: number): string => {
        let letter = '';
        while (col > 0) {
            let temp = (col - 1) % 26;
            letter = String.fromCharCode(65 + temp) + letter;
            col = Math.floor((col - temp) / 26);
        }
        return letter;
    };

    // Populate formulas for each schedule column (from baseCols + 1 to baseCols + dates.length)
    for (let col = baseCols + 1; col <= baseCols + dates.length; col++) {
        const colLetter = getColLetter(col);
        
        // Count formulas
        worksheet.getCell(rowX, col).value = { formula: `COUNTIF(${colLetter}$6:${colLetter}$${lastDataRow}, "X")` };
        worksheet.getCell(rowOk, col).value = { formula: `COUNTIF(${colLetter}$6:${colLetter}$${lastDataRow}, "Ok")` };
        worksheet.getCell(rowN, col).value = { formula: `COUNTIF(${colLetter}$6:${colLetter}$${lastDataRow}, "N")` };
        worksheet.getCell(rowC, col).value = { formula: `COUNTIF(${colLetter}$6:${colLetter}$${lastDataRow}, "C")` };
    }

    if (dates.length > 0) {
        interface WeekSegment {
            week: string;
            startCol: number;
            endCol: number;
        }
        const weekSegments: WeekSegment[] = [];
        let curWeek = '';
        let startCol = baseCols + 1;

        dateHeaders.forEach((h, i) => {
            const colIndex = baseCols + 1 + i;
            if (h.week !== curWeek) {
                if (curWeek) {
                    weekSegments.push({ week: curWeek, startCol, endCol: colIndex - 1 });
                }
                curWeek = h.week;
                startCol = colIndex;
            }
        });
        if (curWeek) {
            weekSegments.push({ week: curWeek, startCol, endCol: baseCols + dateHeaders.length });
        }

        weekSegments.forEach(segment => {
            const startColLetter = getColLetter(segment.startCol);
            const endColLetter = getColLetter(segment.endCol);

            // Merge total and percentage rows across this week's dates/schedule columns
            worksheet.mergeCells(rowTotal, segment.startCol, rowTotal, segment.endCol);
            worksheet.getCell(rowTotal, segment.startCol).value = { formula: `SUM(${startColLetter}${rowX}:${endColLetter}${rowC})` };

            worksheet.mergeCells(rowPctX, segment.startCol, rowPctX, segment.endCol);
            worksheet.getCell(rowPctX, segment.startCol).value = { formula: `IFERROR(SUM(${startColLetter}${rowX}:${endColLetter}${rowX})/${startColLetter}${rowTotal}, 0)` };

            worksheet.mergeCells(rowPctOk, segment.startCol, rowPctOk, segment.endCol);
            worksheet.getCell(rowPctOk, segment.startCol).value = { formula: `IFERROR(SUM(${startColLetter}${rowOk}:${endColLetter}${rowOk})/${startColLetter}${rowTotal}, 0)` };

            worksheet.mergeCells(rowPctN, segment.startCol, rowPctN, segment.endCol);
            worksheet.getCell(rowPctN, segment.startCol).value = { formula: `IFERROR(SUM(${startColLetter}${rowN}:${endColLetter}${rowN})/${startColLetter}${rowTotal}, 0)` };

            worksheet.mergeCells(rowPctC, segment.startCol, rowPctC, segment.endCol);
            worksheet.getCell(rowPctC, segment.startCol).value = { formula: `IFERROR(SUM(${startColLetter}${rowC}:${endColLetter}${rowC})/${startColLetter}${rowTotal}, 0)` };
        });
    }

    // 3. Styling
    const colWidthsMapping: any[] = [];
    if (showID) colWidthsMapping.push({ width: 8 });
    visibleDynamicColsMapping.forEach(() => colWidthsMapping.push({ width: 25 }));
    if (showTask) colWidthsMapping.push({ width: 40 });
    if (showActivity) colWidthsMapping.push({ width: 40 });
    if (showSector) colWidthsMapping.push({ width: 15 });
    dateHeaders.forEach(() => colWidthsMapping.push({ width: 5 }));

    worksheet.columns = colWidthsMapping;

    const borderStyle: Partial<ExcelJS.Borders> = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
    };

    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        // Skip styling empty spacing rows
        if (rowNumber === lastDataRow + 1 || rowNumber === lastDataRow + 2) {
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = {};
                cell.fill = { type: 'pattern', pattern: 'none' };
            });
            return;
        }

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.border = borderStyle;
            cell.font = { name: 'Arial', size: 10 };

            if (rowNumber <= 2) {
                // Main title styling
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
                cell.font = { name: 'Arial', size: 14, bold: true };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            } else if (rowNumber <= 5) {
                // Headers styling
                if (rowNumber === 3) {
                     cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                     cell.font = { name: 'Arial', size: 10, bold: true };
                } else {
                     if (colNumber <= baseCols) {
                         cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
                     } else {
                         cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                     }
                     cell.font = { name: 'Arial', size: 9, bold: true };
                }
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            } else if (rowNumber >= summaryStartRow) {
                // Summary styling
                cell.font = { name: 'Arial', size: 9, bold: true };
                cell.border = borderStyle;

                if (rowNumber === summaryStartRow) {
                    // Header row
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; // Dark Slate
                    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; // White text
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else if (rowNumber === rowX) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNumber > baseCols ? 'FFFEF08A' : 'FFFFFFFF' } };
                    cell.alignment = { vertical: 'middle', horizontal: colNumber <= baseCols ? 'left' : 'center' };
                } else if (rowNumber === rowOk) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNumber > baseCols ? 'FFBBF7D0' : 'FFFFFFFF' } };
                    cell.alignment = { vertical: 'middle', horizontal: colNumber <= baseCols ? 'left' : 'center' };
                } else if (rowNumber === rowN) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNumber > baseCols ? 'FFFECACA' : 'FFFFFFFF' } };
                    cell.alignment = { vertical: 'middle', horizontal: colNumber <= baseCols ? 'left' : 'center' };
                } else if (rowNumber === rowC) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNumber > baseCols ? 'FFBFDBFE' : 'FFFFFFFF' } };
                    cell.alignment = { vertical: 'middle', horizontal: colNumber <= baseCols ? 'left' : 'center' };
                } else if (rowNumber === rowTotal) {
                    // Total Row
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; // Medium-Light slate/gray
                    cell.alignment = { vertical: 'middle', horizontal: colNumber <= baseCols ? 'left' : 'center' };
                    cell.border = {
                        top: { style: 'thin' },
                        bottom: { style: 'double' },
                        left: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                } else if (rowNumber >= rowPctX && rowNumber <= rowPctC) {
                    // Percentage rows
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; // Very light slate
                    cell.alignment = { vertical: 'middle', horizontal: colNumber <= baseCols ? 'left' : 'center' };
                    if (colNumber > baseCols) {
                        cell.numFmt = '0.0%';
                    }
                } else {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                    cell.alignment = { vertical: 'middle', horizontal: colNumber <= baseCols ? 'left' : 'center' };
                }
            } else {
                // Body styling
                if (colNumber <= baseCols) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                    
                    const sectorColNumber = (showID ? 1 : 0) + visibleDynamicColsMapping.length + (showTask ? 1 : 0) + (showActivity ? 1 : 0) + 1;
                    if (showSector && colNumber === sectorColNumber) {
                        // Apply drop-down list validation for choice of sector
                        cell.dataValidation = {
                            type: 'list',
                            allowBlank: true,
                            formulae: ['"CTMSP,IE,IEI,IEP,IE-TS,IPC-C,IPC-M,IPC-MC,IPC-T,IPS,IPS-S,IPS-TT,IPU,IPU-F,IPU-U,IQ,IQ-DT,IQ-LAB,IQ-LP,IQ-REC,IQ-RT,IQ-RX,IQ-SOLDA,IQ-UT,IQ-VT"']
                        };

                        const sectorText = cell.value?.toString().trim().toUpperCase() || '';
                        if (sectorText) {
                            let argbFill = 'FFF1F5F9';
                            let argbText = 'FF475569';
                            if (sectorText === 'CTMSP' || sectorText.startsWith('IE')) {
                                argbFill = 'FFD9D9D9';
                                argbText = 'FF000000';
                            } else if (sectorText === 'IPC-C' || sectorText === 'IPC-T') {
                                argbFill = 'FFFF3B30';
                                argbText = 'FFFFFFFF';
                            } else if (sectorText.startsWith('IPC')) {
                                argbFill = 'FF92D050';
                                argbText = 'FF000000';
                            } else if (sectorText.startsWith('IPS')) {
                                argbFill = 'FFFFFF00';
                                argbText = 'FF000000';
                            } else if (sectorText.startsWith('IPU')) {
                                argbFill = 'FFC6E0B4';
                                argbText = 'FF000000';
                            } else if (sectorText.startsWith('IQ')) {
                                argbFill = 'FF00B0F0';
                                argbText = 'FFFFFFFF';
                            }
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbFill } };
                            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: argbText } };
                            cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        }
                    }
                } else {
                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                    
                    const dateIndex = colNumber - baseCols - 1;
                    if (dateHeaders[dateIndex] && dateHeaders[dateIndex].isWeekend) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
                    }
                    
                    const status = cell.value?.toString();
                    if (status && status !== '') {
                        if (status === Status.Programado) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF08A' } };
                        if (status === Status.Realizado) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBBF7D0' } };
                        if (status === Status.NaoRealizado) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } };
                        if (status === Status.Cancelado) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFDBFE' } };
                    }
                }
            }
        });
    });

    // Add conditional formatting so styling is preserved when edited in Excel
    if (lastDataRow >= 6) {
        // Dates grid status conditional formatting
        if (dates.length > 0) {
            const startColLetter = getColLetter(baseCols + 1);
            const endColLetter = getColLetter(baseCols + dates.length);
            const range = `${startColLetter}6:${endColLetter}${lastDataRow}`;

            worksheet.addConditionalFormatting({
                ref: range,
                rules: [
                    {
                        priority: 1,
                        type: 'cellIs',
                        operator: 'equal',
                        formulae: ['"X"'],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF08A' }, bgColor: { argb: 'FFFEF08A' } }
                        }
                    },
                    {
                        priority: 2,
                        type: 'cellIs',
                        operator: 'equal',
                        formulae: ['"Ok"'],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBBF7D0' }, bgColor: { argb: 'FFBBF7D0' } }
                        }
                    },
                    {
                        priority: 3,
                        type: 'cellIs',
                        operator: 'equal',
                        formulae: ['"N"'],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' }, bgColor: { argb: 'FFFECACA' } }
                        }
                    },
                    {
                        priority: 4,
                        type: 'cellIs',
                        operator: 'equal',
                        formulae: ['"C"'],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFDBFE' }, bgColor: { argb: 'FFBFDBFE' } }
                        }
                    }
                ]
            });
        }

        // Sectors conditional formatting
        if (showSector) {
            const sectorColNumber = (showID ? 1 : 0) + visibleDynamicColsMapping.length + (showTask ? 1 : 0) + (showActivity ? 1 : 0) + 1;
            const sectorColLetter = getColLetter(sectorColNumber);
            const sectorRange = `${sectorColLetter}6:${sectorColLetter}${lastDataRow}`;

            const PREDEFINED_SECTORS = [
              'CTMSP', 'IE', 'IEI', 'IEP', 'IE-TS', 'IPC-C', 'IPC-M', 'IPC-MC', 'IPC-T', 
              'IPS', 'IPS-S', 'IPS-TT', 'IPU', 'IPU-F', 'IPU-U', 'IQ', 'IQ-DT', 'IQ-LAB', 
              'IQ-LP', 'IQ-REC', 'IQ-RT', 'IQ-RX', 'IQ-SOLDA', 'IQ-UT', 'IQ-VT'
            ];

            const sectorRules: any[] = [];
            let priority = 10; // Start priority after dates grid
            PREDEFINED_SECTORS.forEach(sec => {
                const s = sec.toUpperCase();
                let argbFill = 'FFF1F5F9';
                let argbText = 'FF475569';
                
                if (s === 'CTMSP' || s.startsWith('IE')) {
                    argbFill = 'FFD9D9D9';
                    argbText = 'FF000000';
                } else if (s === 'IPC-C' || s === 'IPC-T') {
                    argbFill = 'FFFF3B30';
                    argbText = 'FFFFFFFF';
                } else if (s.startsWith('IPC')) {
                    argbFill = 'FF92D050';
                    argbText = 'FF000000';
                } else if (s.startsWith('IPS')) {
                    argbFill = 'FFFFFF00';
                    argbText = 'FF000000';
                } else if (s.startsWith('IPU')) {
                    argbFill = 'FFC6E0B4';
                    argbText = 'FF000000';
                } else if (s.startsWith('IQ')) {
                    argbFill = 'FF00B0F0';
                    argbText = 'FFFFFFFF';
                }

                sectorRules.push({
                    priority: priority++,
                    type: 'cellIs',
                    operator: 'equal',
                    formulae: [`"${sec}"`],
                    style: {
                        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbFill }, bgColor: { argb: argbFill } },
                        font: { name: 'Arial', size: 9, bold: true, color: { argb: argbText } }
                    }
                });
            });

            worksheet.addConditionalFormatting({
                ref: sectorRange,
                rules: sectorRules
            });
        }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${title.replace(/ /g, '_')}.xlsx`);
};

export const exportToPdfAgent = (
    filteredData: ScheduleData, 
    dates: Date[], 
    activeProject: Project,
    orientation: 'p' | 'l',
    dynamicColumns: DynamicColumn[],
    visibleColumns?: Record<string, boolean>
) => {
    if (filteredData.length === 0) {
        return;
    }

    const title = activeProject.title;
    const lastModified = activeProject.lastModified;
    const programmerName = activeProject.programmerName;

    // Filter dynamic columns by data availability AND visibility
    const visibleDynamicCols = dynamicColumns.filter(col => {
        const hasData = filteredData.some(g => g.customValues?.[col.id] && g.customValues[col.id].trim() !== '');
        const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
        return hasData && isVisible;
    });

    const showID = visibleColumns ? visibleColumns['ID'] !== false : true;
    const showTask = visibleColumns ? visibleColumns['TAREFA PRINCIPAL'] !== false : true;
    const showActivity = visibleColumns ? visibleColumns['ATIVIDADE'] !== false : true;
    const showSector = visibleColumns ? visibleColumns['SETOR'] !== false : true;

    const N = visibleDynamicCols.length;

    // Calculate required width
    let fixedColsWidth = 0;
    if (showID) fixedColsWidth += 40;
    fixedColsWidth += (N * 80);
    if (showTask) fixedColsWidth += 140;
    if (showActivity) fixedColsWidth += 110;
    if (showSector) fixedColsWidth += 70;

    const dateColWidth = 33; 
    const margins = 80;
    const calculatedWidth = fixedColsWidth + (dates.length * dateColWidth) + margins;
    const pageWidth = orientation === 'l' ? Math.max(1190.55, calculatedWidth) : 595.28;
    const pageHeight = 841.89;

    const doc = new jsPDF({ 
        orientation: orientation === 'l' ? 'landscape' : 'portrait', 
        unit: 'pt', 
        format: [pageWidth, pageHeight] 
    });

    // Define columns for autoTable
    const columns: any[] = [];
    if (showID) columns.push({ header: 'ID', dataKey: 'id' });
    visibleDynamicCols.forEach(col => {
        columns.push({ header: col.name, dataKey: `col_${col.id}` });
    });
    if (showTask) columns.push({ header: 'TAREFA PRINCIPAL', dataKey: 'task' });
    if (showActivity) columns.push({ header: 'ATIVIDADE', dataKey: 'activity' });
    if (showSector) columns.push({ header: 'SETOR', dataKey: 'sector' });
    dates.forEach((d, i) => {
        columns.push({ header: `date_${i}`, dataKey: `date_${i}` });
    });

    // Build head
    const totalCols = columns.length;
    const fixedCols = (showID ? 1 : 0) + visibleDynamicCols.length + (showTask ? 1 : 0) + (showActivity ? 1 : 0) + (showSector ? 1 : 0);

    const firstWeek = dates.length > 0 ? getWeek(dates[0]) : '';
    const lastWeek = dates.length > 0 ? getWeek(dates[dates.length - 1]) : '';
    const weekRange = firstWeek === lastWeek ? `${firstWeek}` : `${firstWeek}@${lastWeek}`;
    const mainTitle = `PROGRAMAÇÃO SEMANAL -${weekRange}\n${title.toUpperCase()}`;

    const head0 = [{
        content: mainTitle,
        colSpan: totalCols,
        styles: { halign: 'center', valign: 'middle', fontSize: 14, fontStyle: 'bold', fillColor: [221, 235, 247], textColor: [0, 0, 0] }
    }];

    const head1: any[] = [];
    if (fixedCols > 1) {
        head1.push({
            content: `Elaborado por: ${programmerName || ''}`,
            colSpan: fixedCols - 1,
            styles: { halign: 'center', valign: 'middle', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [0, 0, 0] }
        });
        head1.push({
            content: `Atualizado em: ${new Date(lastModified).toLocaleDateString('pt-BR')}`,
            colSpan: 1,
            styles: { halign: 'center', valign: 'middle', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [0, 0, 0] }
        });
    } else {
        head1.push({
            content: `Elaborado por: ${programmerName || ''} | Atualizado em: ${new Date(lastModified).toLocaleDateString('pt-BR')}`,
            colSpan: 1,
            styles: { halign: 'center', valign: 'middle', fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [0, 0, 0] }
        });
    }

    const weekHeaders: any[] = [];
    if (dates.length > 0) {
        let currentWeek = getWeek(dates[0]);
        let dayCount = 0;
        dates.forEach((date, index) => {
            const week = getWeek(date);
            if (week !== currentWeek) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount, styles: { halign: 'center', valign: 'middle', fillColor: [241, 245, 249], textColor: [0, 0, 0] } });
                currentWeek = week;
                dayCount = 1;
            } else {
                dayCount++;
            }
            if (index === dates.length - 1) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount, styles: { halign: 'center', valign: 'middle', fillColor: [241, 245, 249], textColor: [0, 0, 0] } });
            }
        });
    }
    head1.push(...weekHeaders);

    const head2: any[] = [];
    const head3: any[] = [];
    
    if (showID) head2.push({ content: 'ID', rowSpan: 2, styles: { halign: 'center', valign: 'middle', fillColor: [221, 235, 247], textColor: [0, 0, 0] } });
    visibleDynamicCols.forEach(col => {
        head2.push({ content: col.name.toUpperCase(), rowSpan: 2, styles: { halign: 'center', valign: 'middle', fillColor: [221, 235, 247], textColor: [0, 0, 0] } });
    });
    if (showTask) head2.push({ content: 'TAREFA PRINCIPAL', rowSpan: 2, styles: { halign: 'center', valign: 'middle', fillColor: [221, 235, 247], textColor: [0, 0, 0] } });
    if (showActivity) head2.push({ content: 'ATIVIDADE', rowSpan: 2, styles: { halign: 'center', valign: 'middle', fillColor: [221, 235, 247], textColor: [0, 0, 0] } });
    if (showSector) head2.push({ content: 'SETOR', rowSpan: 2, styles: { halign: 'center', valign: 'middle', fillColor: [221, 235, 247], textColor: [0, 0, 0] } });

    head2.push(...dates.map(date => ({ content: getDayAbbr(date), styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } })));
    head3.push(...dates.map(date => ({ content: date.getUTCDate().toString(), styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [0, 0, 0] } })));

    const head: any[] = [head0, head1, head2, head3];

    const body: any[] = [];
    let wbsGroup = 1;
    filteredData.forEach(group => {
        let isFirstRowOfGroup = true;
        const groupTotalRows = group.tarefas.reduce((acc, t) => acc + (t.activities.length > 0 ? t.activities.length : 1), 0);
        let wbsTask = 1;

        group.tarefas.forEach((task) => {
            let isFirstRowOfTask = true;
            const taskTotalRows = task.activities.length > 0 ? task.activities.length : 1;
            let wbsActivity = 1;

            const activities = task.activities.length > 0 ? task.activities : [{ id: `empty-${task.id}`, name: '', schedule: {} }];
            activities.forEach((activity) => {
                const row: any = {
                    id: `${wbsGroup}.${wbsTask}.${wbsActivity}`,
                    activity: stripHtmlTags(activity.name)
                };
                if (showSector) {
                    row.sector = stripHtmlTags(activity.sector || '');
                }

                // Add grouping fields only on the first row of span
                if (isFirstRowOfGroup) {
                    visibleDynamicCols.forEach(col => {
                        row[`col_${col.id}`] = { content: stripHtmlTags(group.customValues?.[col.id]), rowSpan: groupTotalRows };
                    });
                }
                
                if (isFirstRowOfTask) {
                    const cleanTitle = stripHtmlTags(task.title);
                    const cleanFa = stripHtmlTags(task.fa || '');
                    const taskText = cleanFa && cleanFa !== 'Nº FA' ? `${cleanTitle}\n${cleanFa}` : cleanTitle;
                    row.task = { content: taskText, rowSpan: taskTotalRows };
                }

                // Status for each date
                dates.forEach((date, i) => {
                    row[`date_${i}`] = activity.schedule[formatDate(date)] || '';
                });

                body.push(row);
                isFirstRowOfGroup = false;
                isFirstRowOfTask = false;
                wbsActivity++;
            });
            wbsTask++;
        });
        wbsGroup++;
    });
    
    const columnStyles: any = {};
    let colIdx = 0;
    if (showID) {
        columnStyles[colIdx] = { cellWidth: 40, halign: 'center' };
        colIdx++;
    }
    visibleDynamicCols.forEach(() => {
        columnStyles[colIdx] = { cellWidth: 80, halign: 'left', fontStyle: 'bold' };
        colIdx++;
    });
    if (showTask) {
        columnStyles[colIdx] = { cellWidth: 140, halign: 'left', fontStyle: 'bold' };
        colIdx++;
    }
    if (showActivity) {
        columnStyles[colIdx] = { cellWidth: 110, halign: 'left' };
        colIdx++;
    }
    if (showSector) {
        columnStyles[colIdx] = { cellWidth: 70, halign: 'center' };
        colIdx++;
    }

    autoTable(doc, {
        columns: columns,
        head: head,
        body: body,
        startY: 20,
        theme: 'grid',
        headStyles: { fillColor: [233, 238, 245], textColor: [45, 55, 72], fontStyle: 'bold', lineWidth: 0.5, lineColor: [45, 55, 72] },
        styles: { fontSize: 7, cellPadding: 3, valign: 'middle', halign: 'center', lineColor: [45, 55, 72], lineWidth: 0.5, overflow: 'linebreak' },
        columnStyles: columnStyles,
        didDrawCell: (data) => {
            if (data.section === 'body' && data.column.dataKey === 'sector') {
                const sectorVal = String(data.cell.text[0] || '').trim().toUpperCase();
                if (sectorVal) {
                    let rgbFill = [241, 245, 249];
                    let rgbText = [71, 85, 105];
                    if (sectorVal === 'CTMSP' || sectorVal.startsWith('IE')) {
                        rgbFill = [217, 217, 217];
                        rgbText = [0, 0, 0];
                    } else if (sectorVal === 'IPC-C' || sectorVal === 'IPC-T') {
                        rgbFill = [255, 59, 48];
                        rgbText = [255, 255, 255];
                    } else if (sectorVal.startsWith('IPC')) {
                        rgbFill = [146, 208, 80];
                        rgbText = [0, 0, 0];
                    } else if (sectorVal.startsWith('IPS')) {
                        rgbFill = [255, 255, 0];
                        rgbText = [0, 0, 0];
                    } else if (sectorVal.startsWith('IPU')) {
                        rgbFill = [198, 224, 180];
                        rgbText = [0, 0, 0];
                    } else if (sectorVal.startsWith('IQ')) {
                        rgbFill = [0, 176, 240];
                        rgbText = [255, 255, 255];
                    }
                    doc.setFillColor(rgbFill[0], rgbFill[1], rgbFill[2]);
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                    doc.setTextColor(rgbText[0], rgbText[1], rgbText[2]);
                    doc.setFont(data.cell.styles.font, 'bold');
                    doc.text(String(data.cell.text[0] || ''), data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, { align: 'center', baseline: 'middle' });
                    
                    doc.setDrawColor(45, 55, 72);
                    doc.setLineWidth(0.5);
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'S');
                }
            }

            if (data.section === 'body' && String(data.column.dataKey).startsWith('date_')) {
                const dateIndex = parseInt(String(data.column.dataKey).split('_')[1], 10);
                const currentDate = dates[dateIndex];
                const dayAbbr = getDayAbbr(currentDate);
                const isHoliday = isBrazilianHoliday(currentDate);
                const isWeekendOrHoliday = dayAbbr === 'SÁB' || dayAbbr === 'DOM' || isHoliday;

                if (isWeekendOrHoliday) {
                    doc.setFillColor(224, 242, 254);
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                }
                
                const status = data.cell.text[0] as Status;
                if (status && STATUS_COLOR_MAP[status]) {
                    doc.setFillColor(STATUS_COLOR_MAP[status]);
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                }
                
                if (status) {
                    doc.setTextColor(50, 50, 50);
                    doc.text(String(status), data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, { align: 'center', baseline: 'middle' });
                }
                doc.setDrawColor(45, 55, 72);
                doc.setLineWidth(0.5);
                doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'S');
            }
        }
    });
    doc.save(`${title.replace(/ /g, '_')}.pdf`);
};

export const exportManpowerToPdfAgent = (
    roles: string[],
    data: ManpowerAllocation['data'],
    hasSecondShift: boolean,
    weeks: string[],
    title: string
) => {
    // Basic A4 Landscape is 842. For many weeks, extend it.
    const fixedWidth = 150; // Role col + Total col
    const widthPerWeek = 45; // pt per week column
    const margins = 80;
    const requiredWidth = fixedWidth + (weeks.length * widthPerWeek) + margins;
    const pageWidth = Math.max(841.89, requiredWidth);
    
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [pageWidth, 595.28] });

    doc.setFontSize(16);
    doc.text(`Alocação de Mão de Obra - ${title}`, 40, 40);

    const generateTableForShift = (shiftKey: 'adm' | 'shift2', startY: number): number => {
        doc.setFontSize(12);
        doc.text(shiftKey === 'adm' ? "Turno ADM" : "2º Turno", 40, startY - 5);

        const head: any[] = [[]];
        head[0].push({ content: 'Mão de Obra', styles: { halign: 'left' } });
        weeks.forEach(week => {
            const [year, weekNum] = week.split('-');
            const dateRange = getDateRangeOfWeek(week);
            head[0].push({ content: `Semana ${weekNum} (${year})\n${dateRange}`, styles: { halign: 'center' } });
        });
        head[0].push('Total (H-Sem)');

        const body: any[] = [];
        const shiftData = data[shiftKey];
        const weeklyTotals: Record<string, number> = {};
        weeks.forEach(w => weeklyTotals[w] = 0);

        roles.forEach(role => {
            const rowData: (string|number)[] = [role];
            let total = 0;
            weeks.forEach(week => {
                const quantity = shiftData[role]?.[week] || 0;
                rowData.push(quantity > 0 ? quantity : '');
                total += quantity;
                weeklyTotals[week] += quantity;
            });
            rowData.push(total > 0 ? total : '');
            body.push(rowData);
        });
        
        const grandTotal = Object.values(weeklyTotals).reduce((sum, val) => sum + val, 0);

        const foot: any[] = [[]];
        foot[0].push({ content: 'TOTAL GERAL (H-Sem)', styles: { halign: 'left', fontStyle: 'bold' } });
        weeks.forEach(week => {
            const total = weeklyTotals[week];
            foot[0].push({ content: total > 0 ? String(total) : '', styles: { fontStyle: 'bold' } });
        });
        foot[0].push({ content: grandTotal > 0 ? String(grandTotal) : '', styles: { fontStyle: 'bold' } });

        autoTable(doc, {
            head: head,
            body: body,
            foot: foot,
            startY: startY,
            theme: 'grid',
            headStyles: { fillColor: [233, 238, 245], textColor: [45, 55, 72], fontStyle: 'bold' },
            footStyles: { fillColor: [233, 238, 245], textColor: [45, 55, 72] },
            styles: { fontSize: 8, cellPadding: 3, halign: 'center' },
            columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
        });

        return (doc as any).lastAutoTable.finalY;
    };

    let finalY = generateTableForShift('adm', 70);
    if (hasSecondShift) {
        generateTableForShift('shift2', finalY + 30);
    }


    doc.save(`Alocacao_MO_${title.replace(/ /g, '_')}.pdf`);
};

export const exportDailyAllocationToPdfAgent = (
    project: Project,
    dates: Date[],
    filteredData: ScheduleData,
    title: string
) => {
    // Calculate required width to avoid squeezing
    const fixedColsWidth = 400; // ID, Task, Activity
    const dateColWidth = 30; // 30pt per date minimum
    const margins = 80;
    const calculatedWidth = fixedColsWidth + (dates.length * dateColWidth) + margins;
    const pageWidth = Math.max(1190.55, calculatedWidth); // A3 landscape is ~1190.55

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [pageWidth, 841.89] });
    doc.text(`Alocação Diária de Mão de Obra - ${title}`, 40, 40);

    // --- Main Table ---
    const head: any[] = [
        [
            { content: 'ID', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' } },
            { content: 'Tarefa Principal', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' } },
            { content: 'Atividade', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' } },
        ],
        [],
        []
    ];

    const weekHeaders: { content: string, colSpan: number, styles: { halign: 'center' } }[] = [];
    if (dates.length > 0) {
        let currentWeek = getWeek(dates[0]);
        let dayCount = 0;
        dates.forEach((date, index) => {
            const week = getWeek(date);
            if (week !== currentWeek) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount, styles: { halign: 'center' } });
                currentWeek = week;
                dayCount = 1;
            } else { dayCount++; }
            if (index === dates.length - 1) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount, styles: { halign: 'center' } });
            }
        });
    }
    head[0].push(...weekHeaders as any);
    head[1].push(...dates.map(date => ({ content: getDayAbbr(date), styles: { halign: 'center' } })));
    head[2].push(...dates.map(date => ({ content: date.getUTCDate().toString(), styles: { halign: 'center' } })));

    const body: any[] = [];
    let groupCounter = 1;
    filteredData.forEach(group => {
        let taskCounter = 1;
        group.tarefas.forEach(task => {
            let activityCounter = 1;
            task.activities.forEach(activity => {
                const wbs = `${groupCounter}.${taskCounter}.${activityCounter}`;
                const cleanTitle = stripHtmlTags(task.title);
                const cleanFa = stripHtmlTags(task.fa || '');
                const taskText = cleanFa && cleanFa !== 'Nº FA' ? `${cleanTitle}\n${cleanFa}` : cleanTitle;
                const row: any[] = [{ content: wbs }, { content: taskText }, { content: stripHtmlTags(activity.name) }];
                dates.forEach(date => {
                    const dateStr = formatDate(date);
                    const allocations = project.dailyManpowerAllocation[activity.id]?.[dateStr];
                    const cellText = allocations && Object.keys(allocations).length > 0
                        ? Object.entries(allocations).map(([role, qty]) => `${getRoleAbbreviation(role)}: ${qty}`).join('\n')
                        : '';
                    row.push(cellText);
                });
                body.push(row);
                activityCounter++;
            });
            taskCounter++;
        });
        groupCounter++;
    });

    autoTable(doc, {
        head: head,
        body: body,
        startY: 60,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, valign: 'middle', halign: 'left', lineWidth: 0.5, lineColor: [45,55,72] },
        headStyles: { halign: 'center', fillColor: [233, 238, 245], textColor: [45, 55, 72] },
        columnStyles: { 0: { halign: 'center', cellWidth: 35 }, 1: { halign: 'left', cellWidth: 150 }, 2: { halign: 'left', cellWidth: 150 } },
        didDrawCell: (data) => {
            if (data.section === 'body' && data.column.index >= 3) {
                const dateIndex = data.column.index - 3;
                const currentDate = dates[dateIndex];
                const dateStr = formatDate(currentDate);
                const dayAbbr = getDayAbbr(currentDate);
                const wbs = (data.row.raw[0] as any).content;
                const wbsParts = wbs.split('.').map((n: string) => parseInt(n, 10) - 1);
                const activity = filteredData[wbsParts[0]]?.tarefas[wbsParts[1]]?.activities[wbsParts[2]];

                if (dayAbbr === 'SÁB' || dayAbbr === 'DOM') {
                    doc.setFillColor(224, 242, 254); // Light blue
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                }

                const status = activity?.schedule[dateStr];
                if (status && STATUS_COLOR_MAP[status]) {
                    const hex = STATUS_COLOR_MAP[status];
                    doc.setFillColor(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                }

                const cellText = data.cell.text;
                if (cellText && cellText.length > 0 && cellText[0]) {
                    doc.setTextColor(50, 50, 50);
                    doc.setFontSize(6);
                    doc.text(cellText, data.cell.x + 2, data.cell.y + 3, { baseline: 'top' });
                }

                doc.setDrawColor(45, 55, 72);
                doc.setLineWidth(0.5);
                doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'S');
            }
        },
    });

    // --- Summary Table ---
    const dailyTotals: Record<string, Record<string, number>> = {};
    for (const date of dates) {
        const dateStr = formatDate(date);
        dailyTotals[dateStr] = {};
        project.manpowerAllocation.roles.forEach(role => { dailyTotals[dateStr][role] = 0; });
    }
    filteredData.forEach(group => {
        group.tarefas.forEach(task => {
            task.activities.forEach(activity => {
                if (project.dailyManpowerAllocation[activity.id]) {
                    Object.entries(project.dailyManpowerAllocation[activity.id]).forEach(([dateStr, roles]) => {
                        if (dailyTotals[dateStr]) {
                            Object.entries(roles).forEach(([role, quantity]) => {
                                if (dailyTotals[dateStr][role] !== undefined) {
                                    dailyTotals[dateStr][role] += quantity;
                                }
                            });
                        }
                    });
                }
            });
        });
    });
    
    const weeklyAvailable: Record<string, Record<string, number>> = {};
    const { roles, data: manpowerData, hasSecondShift } = project.manpowerAllocation;
    dates.forEach(date => {
        const weekYear = getWeekYear(date);
        if (!weeklyAvailable[weekYear]) {
            weeklyAvailable[weekYear] = {};
            roles.forEach(role => {
                const admQty = manpowerData.adm[role]?.[weekYear] || 0;
                const shift2Qty = hasSecondShift ? (manpowerData.shift2[role]?.[weekYear] || 0) : 0;
                weeklyAvailable[weekYear][role] = admQty + shift2Qty;
            });
        }
    });

    const dailyGrandTotals: Record<string, { allocated: number; available: number }> = {};
    for (const date of dates) {
        const dateStr = formatDate(date);
        const weekYear = getWeekYear(date);
        const allocated = Object.values(dailyTotals[dateStr] || {}).reduce((sum, val) => sum + val, 0);
        const available = Object.values(weeklyAvailable[weekYear] || {}).reduce((sum, val) => sum + val, 0);
        dailyGrandTotals[dateStr] = { allocated, available };
    }

    const finalY = (doc as any).lastAutoTable.finalY;
    let startY = finalY + 40;
    const pageHeight = doc.internal.pageSize.getHeight();
    const estimatedTableHeight = (project.manpowerAllocation.roles.length + 3) * 18;
    if (startY + estimatedTableHeight > pageHeight - 40) {
        doc.addPage();
        startY = 40;
    }

    doc.setFontSize(14);
    doc.text("Quadro Resumo de Mão de Obra", 40, startY - 15);

    const summaryHead: any[][] = [[ 'Mão de Obra', ...dates.map(d => `${getDayAbbr(d)}\n${d.getUTCDate()}`) ]];
    const summaryBody: any[][] = [];
    project.manpowerAllocation.roles.forEach(role => {
        const row: any[] = [role];
        dates.forEach(date => {
            const dateStr = formatDate(date);
            const weekYear = getWeekYear(date);
            const totalDaily = dailyTotals[dateStr]?.[role] || 0;
            const availableWeekly = weeklyAvailable[weekYear]?.[role] || 0;
            const isSuperAllocated = totalDaily > availableWeekly;
            const isWeekend = getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM';
            row.push({
                content: `${totalDaily} / ${availableWeekly}`,
                styles: {
                    fillColor: isSuperAllocated ? '#fecaca' : (isWeekend ? '#e0f2fe' : undefined),
                    textColor: isSuperAllocated ? '#991b1b' : undefined,
                }
            });
        });
        summaryBody.push(row);
    });

    const summaryFoot: any[][] = [[
        { content: 'TOTAL GERAL', styles: { fontStyle: 'bold' } },
        ...dates.map(date => {
            const dateStr = formatDate(date);
            const totals = dailyGrandTotals[dateStr];
            const isSuperAllocated = totals.allocated > totals.available;
            return {
                content: `${totals.allocated} / ${totals.available}`,
                styles: {
                    fontStyle: 'bold',
                    fillColor: isSuperAllocated ? '#fecaca' : '#d1d5db',
                    textColor: isSuperAllocated ? '#991b1b' : '#1f2937',
                }
            };
        })
    ]];

    autoTable(doc, {
        startY, head: summaryHead, body: summaryBody, foot: summaryFoot, theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, valign: 'middle', halign: 'center', lineWidth: 0.5, lineColor: [45,55,72] },
        headStyles: { halign: 'center', fillColor: [233, 238, 245], textColor: [45, 55, 72] },
        footStyles: { fillColor: '#d1d5db', textColor: '#1f2937' },
        columnStyles: { 0: { halign: 'left', cellWidth: 150, fontStyle: 'bold' } }
    });

    doc.save(`Alocacao_Diaria_${title.replace(/ /g, '_')}.pdf`);
};

export const exportDashboardToPdfAgent = (stats: any, chartImage: string | null, title: string, programmerName: string, selectedWeekInfo: string) => {
    const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;

    doc.setFontSize(16);
    doc.text(`Dashboard do Projeto: ${title}`, margin, 20);
    doc.setFontSize(10);
    doc.text(`Responsável: ${programmerName}`, margin, 28);
    doc.text(`Dados para: ${selectedWeekInfo}`, margin, 36);

    const statData = [
        ['Total Programado', stats.totalProgramado],
        ['Total Realizado', stats.totalRealizado],
        ['Total Cancelado', stats.totalCancelado],
        ['Não Realizado', stats.totalNaoRealizado],
    ];
    autoTable(doc, {
        startY: 42,
        head: [['Métrica de Status', 'Valor']],
        body: statData,
        theme: 'striped',
        margin: { left: margin, right: margin },
    });

    let finalY = (doc as any).lastAutoTable.finalY;

    const componentData = Array.from(stats.tasksPerComponent.entries()).map(([componente, count]) => [componente, count]);
    if(componentData.length > 0) {
        autoTable(doc, {
            startY: finalY + 10,
            head: [['Componente', 'Nº de Atividades']],
            body: componentData,
            theme: 'striped',
            margin: { left: margin, right: margin },
        });
        finalY = (doc as any).lastAutoTable.finalY;
    }
    
    if (chartImage) {
        const spaceForChart = pageHeight - finalY - margin - 10; // 10 for padding below
        if (spaceForChart > 50) { // Only add if there's reasonable space
            try {
                const imgProps = doc.getImageProperties(chartImage);
                const imgWidth = pageWidth - (margin * 2);
                let imgHeight = (imgProps.height * imgWidth) / imgProps.width;
                
                if (imgHeight > spaceForChart) {
                    imgHeight = spaceForChart; // Scale height to fit
                }

                doc.addImage(chartImage, 'PNG', margin, finalY + 10, imgWidth, imgHeight);
            } catch(e) {
                console.error("Error adding chart image to PDF:", e);
                doc.text("Não foi possível renderizar o gráfico.", margin, finalY + 10);
            }
        }
    }
    
    doc.save(`Dashboard_${title.replace(/ /g, '_')}.pdf`);
};

export const exportManpowerDashboardToPdfAgent = (chartImage: string | null, title: string, programmerName: string, selectedWeekInfo: string) => {
    const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    doc.setFontSize(16);
    doc.text(`Dashboard de Mão de Obra: ${title}`, margin, 20);
    doc.setFontSize(10);
    doc.text(`Responsável: ${programmerName}`, margin, 28);
    doc.text(`Dados para: ${selectedWeekInfo}`, margin, 36);

    if (chartImage) {
        try {
            const imgProps = doc.getImageProperties(chartImage);
            const availableWidth = pageWidth - (margin * 2);
            const availableHeight = pageHeight - 45 - margin;
            let imgHeight = (imgProps.height * availableWidth) / imgProps.width;
            let imgWidth = availableWidth;

            if (imgHeight > availableHeight) {
                imgHeight = availableHeight;
                imgWidth = (imgProps.width * imgHeight) / imgProps.height;
            }

            doc.addImage(chartImage, 'PNG', margin, 45, imgWidth, imgHeight);
        } catch(e) {
            console.error("Error adding chart image to PDF:", e);
            doc.text("Não foi possível renderizar o gráfico.", margin, 45);
        }
    } else {
        doc.text("Gráfico não disponível.", margin, 45);
    }
    
    doc.save(`Dashboard_MO_${title.replace(/ /g, '_')}.pdf`);
};

export const exportDailySummaryToWordAgent = async (
    viewMode: 'daily' | 'weekly',
    startDate: string,
    endDate: string,
    searchQuery: string,
    data: any
) => {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
    const { saveAs } = await import('file-saver');

    const children: any[] = [];
    
    if (viewMode === 'daily') {
        children.push(
            new Paragraph({
                text: `Resumo Diário - ${new Date(startDate + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`,
                heading: HeadingLevel.HEADING_1,
                spacing: { after: 200 }
            })
        );
        data.forEach(({ category, tasks }: any) => {
            children.push(new Paragraph({ text: category, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
            tasks.forEach((item: any) => {
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: item.groupTitle, color: '64748b', size: 16 }),
                    ],
                }));
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: `${item.taskTitle} `, bold: true, size: 24 }),
                        item.taskFa ? new TextRun({ text: `(FA: ${item.taskFa})`, italics: true, color: '94a3b8', size: 20 }) : new TextRun({text: ''}),
                    ],
                    spacing: { after: 50 }
                }));

                item.activities.forEach((act: any) => {
                    const statusLabel = {
                        'completed': 'Concluído',
                        'in_progress': 'Em Andamento',
                        'not_started': 'Não Iniciado',
                        'delayed': 'Atrasado',
                        'canceled': 'Cancelado',
                        'not_performed': 'Não Realizado',
                    }[act.status] || act.status;
                    
                    children.push(new Paragraph({
                        children: [
                            new TextRun({ text: `  • ${act.name} `, size: 20 }),
                            new TextRun({ text: `[${statusLabel}]`, bold: true, size: 16 }),
                        ]
                    }));
                });
                children.push(new Paragraph({ text: "" }));
            });
        });
    } else {
         children.push(
            new Paragraph({
                text: `Resumo Semanal/Período${searchQuery.trim() ? ` - Filtro: "${searchQuery}"` : ''}`,
                heading: HeadingLevel.HEADING_1,
                spacing: { after: 100 }
            })
        );
        const startStr = new Date(startDate + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' });
        const endStr = new Date(endDate + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' });
        children.push(
            new Paragraph({
                text: `${startStr} até ${endStr}`,
                spacing: { after: 200 }
            })
        );

        data.forEach((daySummary: any) => {
            if (daySummary.categories.length === 0) return;
            const dStr = daySummary.dateObj.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC', day: '2-digit', month: '2-digit' }).replace(/^\w/, (c: string) => c.toUpperCase());
            children.push(new Paragraph({ text: dStr, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));

            daySummary.categories.forEach(({category, tasks}: any) => {
                children.push(new Paragraph({ text: category, heading: HeadingLevel.HEADING_3, spacing: { before: 100, after: 50 } }));
                tasks.forEach((item: any) => {
                    children.push(new Paragraph({
                        children: [
                            new TextRun({ text: item.groupTitle, color: '64748b', size: 16 }),
                        ],
                    }));
                    children.push(new Paragraph({
                        children: [
                            new TextRun({ text: `${item.taskTitle} `, bold: true, size: 20 }),
                            item.taskFa ? new TextRun({ text: `(FA: ${item.taskFa})`, italics: true, color: '94a3b8', size: 16 }) : new TextRun({text: ''}),
                        ]
                    }));

                    item.activities.forEach((act: any) => {
                        const statusLabel = {
                            'completed': 'Concluído',
                            'in_progress': 'Em Andamento',
                            'not_started': 'Não Iniciado',
                            'delayed': 'Atrasado',
                            'canceled': 'Cancelado',
                            'not_performed': 'Não Realizado',
                        }[act.status] || act.status;

                        children.push(new Paragraph({
                            children: [
                                new TextRun({ text: `  • ${act.name} `, size: 20 }),
                                new TextRun({ text: `[${statusLabel}]`, bold: true, size: 16 }),
                            ]
                        }));
                    });
                    children.push(new Paragraph({ text: "" }));
                });
            });
        });
    }

    const doc = new Document({
        sections: [{
            children: children
        }]
    });

    Packer.toBlob(doc).then(blob => {
        saveAs(blob, `resumo_${viewMode}.docx`);
    });
};
