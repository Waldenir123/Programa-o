import { utils } from 'xlsx';
import { ScheduleData, Status, Grupo } from '../state/types';
import { generateId, formatDate } from './dataUtils';

export const parseTabularData = (rows: any[][]): ScheduleData => {
    if (rows.length < 2) {
        throw new Error("Dados insuficientes. É necessária pelo menos uma linha de cabeçalho e uma de dados.");
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    const dates: { date: Date, index: number }[] = [];
    for (let i = 5; i < headers.length; i++) {
        const header = headers[i];
        let date: Date | null = null;
        if (header instanceof Date) {
            date = new Date(Date.UTC(header.getFullYear(), header.getMonth(), header.getDate()));
        } else if (typeof header === 'string' && header.trim() !== '') {
            const parts = header.split(/[\/\-]/);
            if (parts.length === 3) {
                const year = parts[2].length === 4 ? Number(parts[2]) : 2000 + Number(parts[2]);
                const month = Number(parts[1]) - 1;
                const day = Number(parts[0]);
                date = new Date(Date.UTC(year, month, day));
            }
        } else if (typeof header === 'number') { // Excel date serial number
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            date = new Date(excelEpoch.getTime() + header * 24 * 60 * 60 * 1000);
        }
        
        if (date && !isNaN(date.getTime())) {
            dates.push({ date, index: i });
        }
    }

    if (dates.length === 0) {
        throw new Error("Nenhuma coluna de data válida foi encontrada. As datas devem estar no formato DD/MM/YYYY a partir da 6ª coluna.");
    }

    const groups: Record<string, Grupo> = {};
    let lastFA = '', lastTitle = '';

    dataRows.forEach(row => {
        if(row.every(cell => cell === null || cell === '' || cell === undefined)) return;

        const fa = (row[0] || lastFA).toString().trim();
        // Skip componente (row[1]) and setor (row[2]) since they are no longer needed
        const title = (row[3] || lastTitle).toString().trim();
        const activityName = (row[4] || '').toString().trim();

        if (!activityName) return;

        const groupKey = `${fa}`;
        if (!groups[groupKey]) {
            groups[groupKey] = { 
                id: generateId(), 
                customValues: { fa }, 
                tarefas: [] 
            };
        }
        const currentGroup = groups[groupKey];

        let currentTask = currentGroup.tarefas.find(t => t.title === title);
        if (!currentTask) {
            currentTask = { id: generateId(), title, activities: [] };
            currentGroup.tarefas.push(currentTask);
        }

        const schedule: Record<string, Status> = {};
        dates.forEach(({ date, index }) => {
            const statusVal = row[index];
            if (statusVal) {
                const statusStr = String(statusVal).trim();
                if (Object.values(Status).includes(statusStr as Status)) {
                    schedule[formatDate(date)] = statusStr as Status;
                }
            }
        });

        currentTask.activities.push({ id: generateId(), name: activityName, schedule });
        
        lastFA = fa;
        lastTitle = title;
    });

    return Object.values(groups);
};
