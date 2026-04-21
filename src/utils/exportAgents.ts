import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ScheduleData, Status, ManpowerAllocation, Project, DynamicColumn } from '../state/types';
import { getWeek, getDayAbbr, formatDate, getDateRangeOfWeek, isBrazilianHoliday, getRoleAbbreviation, getWeekYear } from './dataUtils';
import { STATUS_COLOR_MAP } from '../state/types';

import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
// Removed 'import { utils, writeFile } from 'xlsx';' using grep later, simply replacing the function here

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

    const baseCols = (showID ? 1 : 0) + visibleDynamicColsMapping.length + (showTask ? 1 : 0) + (showActivity ? 1 : 0);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cronograma');

    // 1. Build Headers
    const weekHeadersRow: string[] = Array(baseCols).fill('');
    const dayNameHeadersRow: string[] = [];
    if (showID) dayNameHeadersRow.push('ID');
    visibleDynamicColsMapping.forEach(c => dayNameHeadersRow.push(c.label));
    if (showTask) dayNameHeadersRow.push('TAREFA PRINCIPAL');
    if (showActivity) dayNameHeadersRow.push('ATIVIDADE');
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

    // Merge Week Headers
    let currentWeek = '';
    let weekColStart = baseCols + 1;
    dateHeaders.forEach((h, i) => {
        const colIndex = baseCols + 1 + i;
        if (h.week !== currentWeek) {
            if (currentWeek) {
                worksheet.mergeCells(1, weekColStart, 1, colIndex - 1);
            }
            currentWeek = h.week;
            weekColStart = colIndex;
        }
    });
    if (currentWeek) {
        worksheet.mergeCells(1, weekColStart, 1, baseCols + dateHeaders.length);
    }

    // Merge Fixed Columns Vertically
    for (let c = 1; c <= baseCols; c++) {
        worksheet.mergeCells(2, c, 3, c);
    }

    // 2. Build Body
    let currentRow = 4;
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
                    rowData.push(group.customValues?.[col.id] || '');
                });
                
                if (showTask) rowData.push(task.title);
                if (showActivity) rowData.push(activity.name);
                
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

    // 3. Styling
    const colWidthsMapping: any[] = [];
    if (showID) colWidthsMapping.push({ width: 8 });
    visibleDynamicColsMapping.forEach(() => colWidthsMapping.push({ width: 25 }));
    if (showTask) colWidthsMapping.push({ width: 40 });
    if (showActivity) colWidthsMapping.push({ width: 40 });
    dateHeaders.forEach(() => colWidthsMapping.push({ width: 5 }));

    worksheet.columns = colWidthsMapping;

    const borderStyle: Partial<ExcelJS.Borders> = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
    };

    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.border = borderStyle;
            cell.font = { name: 'Arial', size: 10 };

            if (rowNumber <= 3) {
                // Header styling
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
                cell.font = { name: 'Arial', size: 10, bold: true };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            } else {
                // Body styling
                if (colNumber <= baseCols) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
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

    const N = visibleDynamicCols.length;

    // Calculate required width
    let fixedColsWidth = 0;
    if (showID) fixedColsWidth += 40;
    fixedColsWidth += (N * 80);
    if (showTask) fixedColsWidth += 140;
    if (showActivity) fixedColsWidth += 110;

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

    // Header
    doc.setFontSize(16);
    doc.setTextColor(45, 55, 72);
    doc.text(title, 40, 40);

    const updatedDate = new Date(lastModified).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Responsável: ${programmerName}`, 40, 55);
    doc.text(`Última Atualização: ${updatedDate}`, doc.internal.pageSize.getWidth() - 40, 40, { align: 'right' });

    // Define columns for autoTable
    const columns: any[] = [];
    if (showID) columns.push({ header: 'ID', dataKey: 'id' });
    visibleDynamicCols.forEach(col => {
        columns.push({ header: col.name, dataKey: `col_${col.id}` });
    });
    if (showTask) columns.push({ header: 'TAREFA PRINCIPAL', dataKey: 'task' });
    if (showActivity) columns.push({ header: 'ATIVIDADE', dataKey: 'activity' });
    dates.forEach((d, i) => {
        columns.push({ header: `date_${i}`, dataKey: `date_${i}` });
    });

    // Build head (3 levels for Weeks, Days, Dates)
    const row1: any[] = [];
    if (showID) row1.push({ content: 'ID', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' } });
    visibleDynamicCols.forEach(col => {
        row1.push({ content: col.name, rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' } });
    });
    if (showTask) row1.push({ content: 'TAREFA PRINCIPAL', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' } });
    if (showActivity) row1.push({ content: 'ATIVIDADE', rowSpan: 3, styles: { halign: 'center', vAlign: 'middle' } });

    const head: any[] = [row1, [], []];

    const weekHeaders: any[] = [];
    if (dates.length > 0) {
        let currentWeek = getWeek(dates[0]);
        let dayCount = 0;
        dates.forEach((date, index) => {
            const week = getWeek(date);
            if (week !== currentWeek) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount, styles: { halign: 'center' } });
                currentWeek = week;
                dayCount = 1;
            } else {
                dayCount++;
            }
            if (index === dates.length - 1) {
                weekHeaders.push({ content: `Semana ${currentWeek}`, colSpan: dayCount, styles: { halign: 'center' } });
            }
        });
    }
    head[0].push(...weekHeaders);
    head[1].push(...dates.map(date => ({ content: getDayAbbr(date), styles: { halign: 'center' } })));
    head[2].push(...dates.map(date => ({ content: date.getUTCDate().toString(), styles: { halign: 'center' } })));

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
                    activity: activity.name
                };

                // Add grouping fields only on the first row of span
                if (isFirstRowOfGroup) {
                    visibleDynamicCols.forEach(col => {
                        row[`col_${col.id}`] = { content: group.customValues?.[col.id] || '', rowSpan: groupTotalRows };
                    });
                }
                
                if (isFirstRowOfTask) {
                    row.task = { content: task.title, rowSpan: taskTotalRows };
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

    autoTable(doc, {
        columns: columns,
        head: head,
        body: body,
        startY: 70,
        theme: 'grid',
        headStyles: { fillColor: [233, 238, 245], textColor: [45, 55, 72], fontStyle: 'bold', lineWidth: 0.5, lineColor: [45, 55, 72] },
        styles: { fontSize: 7, cellPadding: 3, valign: 'middle', halign: 'center', lineColor: [45, 55, 72], lineWidth: 0.5, overflow: 'linebreak' },
        columnStyles: columnStyles,
        didDrawCell: (data) => {
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
                const row: any[] = [{ content: wbs }, { content: task.title }, { content: activity.name }];
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
