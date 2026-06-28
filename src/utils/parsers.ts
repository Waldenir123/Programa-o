import { ScheduleData, Status, Grupo } from '../state/types';
import { generateId, formatDate } from './dataUtils';

/**
 * Calculates the Monday of a given ISO week number and year.
 */
function getLocalDateOfISOWeek(w: number, y: number): Date {
    const simple = new Date(Date.UTC(y, 0, 4));
    const dayOfWeek = simple.getUTCDay();
    const isoWeek1Monday = new Date(simple.getTime() - ((dayOfWeek === 0 ? 7 : dayOfWeek) - 1) * 24 * 60 * 60 * 1000);
    return new Date(isoWeek1Monday.getTime() + (w - 1) * 7 * 24 * 60 * 60 * 1000);
}

/**
 * Resolves the absolute date given a day of week offset, day of month, and a reference date.
 */
function resolveDateFromDayOfWeekAndDay(dayOfWeekOffset: number, dayOfMonth: number, refDate: Date): Date {
    const year = refDate.getUTCFullYear();
    let bestDate: Date | null = null;
    let minDiff = Infinity;
    
    // Check months in ref year, previous year, and next year
    for (let y = year - 1; y <= year + 1; y++) {
        for (let m = 0; m < 12; m++) {
            const testDate = new Date(Date.UTC(y, m, dayOfMonth));
            if (testDate.getUTCDate() === dayOfMonth) {
                const utcDay = testDate.getUTCDay();
                const testDayOfWeekOffset = (utcDay + 6) % 7; // Convert 0 (Sun) to 6 (Sun), 1 (Mon) to 0 (Mon)
                if (testDayOfWeekOffset === dayOfWeekOffset) {
                    const diff = Math.abs(testDate.getTime() - refDate.getTime());
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestDate = testDate;
                    }
                }
            }
        }
    }
    return bestDate || new Date(refDate.getTime());
}

/**
 * Resolves the absolute date given only a day of month and a reference date.
 */
function resolveDateFromDayOnly(dayOfMonth: number, refDate: Date): Date {
    const year = refDate.getUTCFullYear();
    let bestDate: Date | null = null;
    let minDiff = Infinity;
    
    for (let y = year - 1; y <= year + 1; y++) {
        for (let m = 0; m < 12; m++) {
            const testDate = new Date(Date.UTC(y, m, dayOfMonth));
            if (testDate.getUTCDate() === dayOfMonth) {
                const diff = Math.abs(testDate.getTime() - refDate.getTime());
                if (diff < minDiff) {
                    minDiff = diff;
                    bestDate = testDate;
                }
            }
        }
    }
    return bestDate || new Date(refDate.getTime());
}

/**
 * Robust day of week detection helper that handles accents and encoding issues (e.g. SB).
 */
const getDayOffset = (text: string): number | null => {
    const t = text.toUpperCase().trim();
    if (t.startsWith('SEG')) return 0;
    if (t.startsWith('TER')) return 1;
    if (t.startsWith('QUA')) return 2;
    if (t.startsWith('QUI')) return 3;
    if (t.startsWith('SEX')) return 4;
    if (t.startsWith('S') && (t.includes('B') || t.includes('A') || t.includes('?') || t.includes('Á') || t.includes('\uFFFD') || t === 'SB')) return 5;
    if (t.startsWith('DOM')) return 6;
    return null;
};

/**
 * Parses delimited text format (TXT/CSV/TSV) into rows matrix any[][]
 * State machine to correctly handle quotes and newlines inside quotes.
 */
export const parseTxtToRows = (text: string): any[][] => {
    if (!text) return [];

    // Pre-process text to fix common accidental tab splitting before parsing
    text = text.replace(/(N[º°\s]*FA)\s*\t\s*(\d+)/gi, "$1 $2");
    text = text.replace(/(FA)\s*\t\s*(\d+)/gi, "$1 $2");

    // 1. Detect delimiter
    // Count occurrences of possible delimiters on lines that are NOT inside quotes
    let tabCount = 0;
    let semiCount = 0;
    let commaCount = 0;
    let inQuotes = false;
    for (let i = 0; i < Math.min(text.length, 1000); i++) {
        const char = text[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (!inQuotes) {
            if (char === '\t') tabCount++;
            else if (char === ';') semiCount++;
            else if (char === ',') commaCount++;
        }
    }

    let delimiter = '\t';
    if (semiCount > tabCount && semiCount > commaCount) {
        delimiter = ';';
    } else if (commaCount > tabCount && commaCount > semiCount) {
        delimiter = ',';
    }

    // 2. Parse using state machine
    const rows: any[][] = [];
    let currentRow: any[] = [];
    let currentCell = '';
    inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Double quotes inside quotes means a literal quote
                currentCell += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++; // skip \n
            }
            currentRow.push(currentCell.trim());
            rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }

    // Add any remaining data
    if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
    }

    // Clean empty trailing lines
    return rows.filter(row => row.length > 0 && row.some(cell => cell !== ''));
};

/**
 * Intelligent parser of tabular data (matrix of values, e.g. from Excel or TXT split)
 */
export const parseTabularData = (rows: any[][], projectStartDate?: string): ScheduleData => {
    if (rows.length < 2) {
        throw new Error("Dados insuficientes. É necessária pelo menos uma linha de cabeçalho e uma de dados.");
    }

    // 1. Locate the main column header row (which contains TASK or ACTIVITY keywords)
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
        const row = rows[r];
        if (!row) continue;
        const hasTask = row.some(cell => {
            const val = String(cell || '').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return val.includes("TAREFA PRINCIPAL") || val.includes("ATIVIDADE") || val.includes("TAREFA");
        });
        if (hasTask) {
            headerRowIdx = r;
            break;
        }
    }

    const headerRow = rows[headerRowIdx];
    let idColIndex = -1;
    let taskColIndex = -1;
    let activityColIndex = -1;
    let sectorColIndex = -1;
    let faColIndex = -1;

    for (let c = 0; c < headerRow.length; c++) {
        const cellText = String(headerRow[c] || '').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        if (cellText === 'ID' || cellText === 'WBS') {
            idColIndex = c;
        } else if (cellText.includes('TAREFA PRINCIPAL') || cellText === 'TAREFA') {
            taskColIndex = c;
        } else if (cellText.includes('ATIVIDADE') || cellText === 'ATIVIDADES') {
            activityColIndex = c;
        } else if (cellText.includes('SETOR') || cellText === 'EQUIPE') {
            sectorColIndex = c;
        } else if (cellText.includes('FA') || cellText.includes('FICHA') || cellText === 'GRUPO') {
            faColIndex = c;
        }
    }

    // Fallbacks if not found
    if (taskColIndex === -1) taskColIndex = 1; // standard position
    if (activityColIndex === -1) activityColIndex = 2;
    if (sectorColIndex === -1) sectorColIndex = 3;

    // 2. Scan first rows to detect the year of the schedule (defaults to current year)
    let detectedYear = new Date().getFullYear();
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const cellVal = String(rows[r][c] || '');
            const match = cellVal.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-](\d{4})\b/);
            if (match) {
                detectedYear = Number(match[1]);
                break;
            }
        }
    }

    // 3. Find where date columns start
    let firstDateColIndex = -1;
    for (let c = 0; c < headerRow.length; c++) {
        const cellText = String(headerRow[c] || '').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const isDayOfWeek = getDayOffset(cellText) !== null;
        const isDatePattern = cellText.match(/^\d{1,2}[\/\-]\d{1,2}/);
        if (isDayOfWeek || isDatePattern) {
            firstDateColIndex = c;
            break;
        }
    }

    if (firstDateColIndex === -1) {
        // Fallback: columns after the known text columns
        firstDateColIndex = Math.max(taskColIndex, activityColIndex, sectorColIndex, faColIndex) + 1;
        if (firstDateColIndex >= headerRow.length) firstDateColIndex = 4;
    }

    // Helper to extract or resolve date of column `c`
    const getDateForColumn = (c: number, lastResolved: Date): Date | null => {
        const cellVal = headerRow[c];
        
        // A. Is the cell already a Date object?
        if (cellVal instanceof Date) {
            return new Date(Date.UTC(cellVal.getFullYear(), cellVal.getMonth(), cellVal.getDate()));
        }

        // Is it a number representing an Excel date serial?
        if (typeof cellVal === 'number' && cellVal > 30000 && cellVal < 60000) {
            const dateObj = new Date(Math.round((cellVal - 25569) * 86400 * 1000));
            return new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
        }

        const cellStr = String(cellVal || '').trim();
        if (!cellStr) return null;

        // Is cellStr a string representing an Excel date serial?
        const numVal = Number(cellStr);
        if (!isNaN(numVal) && numVal > 30000 && numVal < 60000) {
            const dateObj = new Date(Math.round((numVal - 25569) * 86400 * 1000));
            return new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
        }

        // B. Is the cell a full date string? (DD/MM/YYYY or YYYY-MM-DD)
        let parts = cellStr.split(/[\/\-]/);
        if (parts.length === 3) {
            const year = parts[2].length === 4 ? Number(parts[2]) : 2000 + Number(parts[2]);
            const month = Number(parts[1]) - 1;
            const day = Number(parts[0]);
            return new Date(Date.UTC(year, month, day));
        }

        // C. Is the cell a DD/MM date string? (e.g. 15/06)
        if (parts.length === 2) {
            const day = Number(parts[0]);
            const month = Number(parts[1]) - 1;
            if (!isNaN(day) && !isNaN(month)) {
                return new Date(Date.UTC(detectedYear, month, day));
            }
        }

        // D. Day of week + Day of month format (e.g. SEG_15, TER-16, DOM 21, SAB_20, etc.)
        const normalized = cellStr.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const dWMatch = normalized.match(/^([A-Z\uFFFD\?]+)[\s_\-]*(\d+)/);
        if (dWMatch) {
            const dayOfWeekOffset = getDayOffset(dWMatch[1]);
            const dayOfMonth = Number(dWMatch[2]);
            if (dayOfWeekOffset !== null && !isNaN(dayOfMonth)) {
                return resolveDateFromDayOfWeekAndDay(dayOfWeekOffset, dayOfMonth, lastResolved);
            }
        }

        // E. Standard 3-line format: Row above contains "Semana X" and Row main has "SEG", "TER"...
        const dayOffset = getDayOffset(cellStr);
        if (dayOffset !== null) {
            let weekNumber = -1;
            const weekRowIndex = headerRowIdx >= 1 ? headerRowIdx - 1 : -1;
            if (weekRowIndex !== -1) {
                const weekRow = rows[weekRowIndex];
                // Go left to find the closest non-empty cell starting with "Semana"
                for (let col = c; col >= 0; col--) {
                    const weekCellText = String(weekRow[col] || '').toUpperCase().trim();
                    const weekMatch = weekCellText.match(/SEMANA\s*(\d+)/i);
                    if (weekMatch) {
                        weekNumber = Number(weekMatch[1]);
                        break;
                    }
                }
            }

            if (weekNumber !== -1) {
                const monday = getLocalDateOfISOWeek(weekNumber, detectedYear);
                return new Date(monday.getTime() + dayOffset * 24 * 60 * 60 * 1000);
            }
        }

        // F. Just a day number (e.g. 15, 16...)
        const dayNum = Number(cellStr);
        if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
            return resolveDateFromDayOnly(dayNum, lastResolved);
        }

        return null;
    };

    // 4. Resolve all date columns
    const dates: { date: Date, index: number }[] = [];
    const refDateStr = projectStartDate || new Date().toISOString().split('T')[0];
    let lastResolved = new Date(refDateStr + 'T00:00:00Z');

    // First pass to see if we can locate an actual date column to set a more precise initial lastResolved
    for (let c = firstDateColIndex; c < headerRow.length; c++) {
        const cellVal = headerRow[c];
        if (cellVal instanceof Date) {
            lastResolved = new Date(Date.UTC(cellVal.getFullYear(), cellVal.getMonth(), cellVal.getDate()));
            break;
        }
        const cellStr = String(cellVal || '').trim();
        let parts = cellStr.split(/[\/\-]/);
        if (parts.length === 3) {
            const year = parts[2].length === 4 ? Number(parts[2]) : 2000 + Number(parts[2]);
            const month = Number(parts[1]) - 1;
            const day = Number(parts[0]);
            lastResolved = new Date(Date.UTC(year, month, day));
            break;
        }
    }

    for (let c = firstDateColIndex; c < headerRow.length; c++) {
        const d = getDateForColumn(c, lastResolved);
        if (d && !isNaN(d.getTime())) {
            dates.push({ date: d, index: c });
            lastResolved = d; // update lastResolved so the next column is resolved relative to this one!
        } else if (projectStartDate) {
            const base = new Date(projectStartDate + 'T00:00:00Z');
            const offsetDays = c - firstDateColIndex;
            const fallbackDate = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
            dates.push({ date: fallbackDate, index: c });
            lastResolved = fallbackDate;
        }
    }

    if (dates.length === 0) {
        throw new Error("Nenhuma coluna de data válida foi encontrada. As colunas de datas devem estar identificadas por dias da semana ('SEG', 'TER', etc.) ou datas ('DD/MM/YYYY').");
    }

    // 5. Determine where data rows actually start
    let dataRowStartIndex = headerRowIdx + 1;
    if (dataRowStartIndex < rows.length) {
        const nextRow = rows[dataRowStartIndex];
        let numericCount = 0;
        let totalChecked = 0;
        for (let c = firstDateColIndex; c < Math.min(nextRow.length, firstDateColIndex + 10); c++) {
            if (nextRow[c] !== undefined && nextRow[c] !== '') {
                const isNum = !isNaN(Number(nextRow[c]));
                if (isNum) numericCount++;
                totalChecked++;
            }
        }
        if (totalChecked > 0 && (numericCount / totalChecked) > 0.6) {
            dataRowStartIndex++;
        }
    }

    // 6. Build the schedule data groups
    const groups: Record<string, Grupo> = {};
    let lastFA = 'Geral';
    let lastTitle = '';

    const dataRows = rows.slice(dataRowStartIndex).map(rawRow => {
        const row = [...rawRow];
        // If firstDateColIndex is valid, and the column value at that index looks like a sector,
        // it means we have a shifted row due to accidental tab split inside the Task Title.
        if (firstDateColIndex !== -1 && row[firstDateColIndex]) {
            const val = String(row[firstDateColIndex]).trim().toUpperCase();
            const looksLikeSector = val.startsWith('IP') || val.startsWith('IQ') || val.startsWith('IE') || val === 'CTMSP' || val.includes('-LAB') || val.includes('-REC') || val.includes('-UT') || val.includes('-LP') || val.includes('-M') || val.includes('-S');
            if (looksLikeSector) {
                const targetTaskCol = taskColIndex !== -1 ? taskColIndex : 0;
                if (row.length > targetTaskCol + 1) {
                    const taskPart = String(row[targetTaskCol] || '').trim();
                    const extraPart = String(row[targetTaskCol + 1] || '').trim();
                    row[targetTaskCol] = extraPart ? `${taskPart} ${extraPart}` : taskPart;
                    row.splice(targetTaskCol + 1, 1);
                }
            }
        }
        return row;
    });

    dataRows.forEach(row => {
        if (row.every(cell => cell === null || cell === '' || cell === undefined)) return;

        let title = '';
        if (taskColIndex !== -1 && row[taskColIndex]) {
            title = String(row[taskColIndex]).trim();
        }

        let fa = '';
        if (faColIndex !== -1 && row[faColIndex]) {
            fa = String(row[faColIndex]).trim();
        } else if (faColIndex === -1 && title) {
            fa = title;
        }

        // Handle case where title contains both "Grupo Title" and "Nº FA XXXXX" split by \n
        if (title.includes('\n')) {
            const parts = title.split('\n');
            const faPart = parts.find(p => {
                const upper = p.toUpperCase();
                return upper.match(/FA\s*[:\s]*\d+/) || upper.match(/FICHA\s*[:\s]*\d+/) || upper.startsWith('N FA') || upper.startsWith('Nº FA');
            });
            if (faPart) {
                fa = faPart.trim();
                title = parts.filter(p => p !== faPart).join(' ').trim();
            }
        }

        // Propagate merged cells values (empty cells fallback to previous rows)
        if (!fa) {
            fa = lastFA;
        } else {
            lastFA = fa;
        }

        if (!title) {
            title = lastTitle;
        } else {
            lastTitle = title;
        }

        const activityName = activityColIndex !== -1 && row[activityColIndex] ? String(row[activityColIndex]).trim() : '';
        if (!activityName) return; // ignore rows without activities

        const sector = sectorColIndex !== -1 && row[sectorColIndex] ? String(row[sectorColIndex]).trim() : '';

        const groupKey = fa || 'Geral';
        if (!groups[groupKey]) {
            groups[groupKey] = {
                id: generateId(),
                customValues: { fa: groupKey },
                tarefas: []
            };
        }
        const currentGroup = groups[groupKey];

        let currentTask = currentGroup.tarefas.find(t => t.title === title);
        if (!currentTask) {
            currentTask = { id: generateId(), title, activities: [] };
            currentGroup.tarefas.push(currentTask);
        }

        // Read date statuses
        const schedule: Record<string, Status> = {};
        dates.forEach(({ date, index }) => {
            const statusVal = row[index];
            if (statusVal !== undefined && statusVal !== null) {
                const statusStr = String(statusVal).trim();
                let normalizedStatus: Status | null = null;
                
                const valUpper = statusStr.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (valUpper === 'OK' || valUpper === 'REALIZADO') {
                    normalizedStatus = Status.Realizado;
                } else if (valUpper === 'C' || valUpper === 'CANCELADO') {
                    normalizedStatus = Status.Cancelado;
                } else if (valUpper === 'N' || valUpper === 'NAO REALIZADO' || valUpper === 'NAO') {
                    normalizedStatus = Status.NaoRealizado;
                } else if (valUpper === 'X' || valUpper === 'PROGRAMADO' || valUpper === 'P') {
                    normalizedStatus = Status.Programado;
                }
                
                if (normalizedStatus) {
                    schedule[formatDate(date)] = normalizedStatus;
                }
            }
        });

        currentTask.activities.push({
            id: generateId(),
            name: activityName,
            sector: sector || undefined,
            schedule
        });
    });

    return Object.values(groups);
};
