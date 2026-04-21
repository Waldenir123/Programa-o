import { Status, Atividade, ScheduleData, RenderableRow } from '../state/types';

// --- UTILITY FUNCTIONS ---
export const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
export const formatDate = (date: Date): string => date.toISOString().split('T')[0];
export const getDayAbbr = (date: Date) => ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'][date.getUTCDay()];
export const getWeek = (date: Date) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};
export const getWeekYear = (date: Date): string => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // Thursday in current week decides the year.
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    // Get year of Thursday
    const year = d.getUTCFullYear();
    // Get first day of year
    const yearStart = new Date(Date.UTC(year, 0, 1));
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${year}-${weekNo.toString().padStart(2, '0')}`;
};
export const getDatesOfWeek = (weekYear: string): Date[] => {
    const [year, weekNo] = weekYear.split('-').map(Number);
    const d = new Date(Date.UTC(year, 0, 1 + (weekNo - 1) * 7));
    const dayOfWeek = d.getUTCDay();
    const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(d.setUTCDate(diff));
    
    return Array.from({length: 7}, (_, i) => {
        const date = new Date(monday);
        date.setUTCDate(monday.getUTCDate() + i);
        return date;
    });
};
export const getDateRangeOfWeek = (weekYear: string): string => {
    const [year, weekNo] = weekYear.split('-').map(Number);
    // Find the date of the first day (Monday) of the week
    const d = new Date(Date.UTC(year, 0, 1 + (weekNo - 1) * 7));
    const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ..
    const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday to get Monday
    const monday = new Date(d.setUTCDate(diff));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    
    const format = (dt: Date) => `${dt.getUTCDate().toString().padStart(2, '0')}/${(dt.getUTCMonth() + 1).toString().padStart(2, '0')}`;
    
    return `${format(monday)} - ${format(sunday)}`;
};

export const isBrazilianHoliday = (date: Date): boolean => {
    const day = date.getUTCDate();
    const month = date.getUTCMonth() + 1; // 1-12

    const holidays = [
        '1-1',   // Confraternização Universal
        '4-21',  // Tiradentes
        '5-1',   // Dia do Trabalho
        '9-7',   // Independência do Brasil
        '10-12', // Nossa Senhora Aparecida
        '11-2',  // Finados
        '11-15', // Proclamação da República
        '12-25'  // Natal
    ];
    
    return holidays.includes(`${month}-${day}`);
};

export const getRoleAbbreviation = (role: string): string => {
    const lowerRole = role.toLowerCase();
    if (lowerRole.includes('supervisor de caldeiraria')) return 'Sup Cald';
    if (lowerRole.includes('supervisor de solda')) return 'Sup Solda';
    if (lowerRole.includes('caldeireiro')) return 'Cald';
    if (lowerRole.includes('soldador')) return 'Sold';
    if (lowerRole.includes('traçador')) return 'Traç';
    if (lowerRole.includes('operador de oxicorte')) return 'Op Oxicorte';
    if (lowerRole.includes('tratamento térmico')) return 'Trat Térm';
    if (lowerRole.includes('inspetor de solda')) return 'Insp Solda';
    if (lowerRole.includes('inspetor de ultrassom')) return 'Insp UT';
    if (lowerRole.includes('inspetor de rx')) return 'Insp RX';
    if (lowerRole.includes('inspetor dimensional')) return 'Insp Dim';
    
    const words = role.split(' ');
    if (words.length > 1) {
        return words.map(w => w.substring(0, 1)).join('').toUpperCase() + words[words.length - 1].substring(0, 3);
    }
    return role.substring(0, 5);
};

export const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

export function safeJsonParse<T>(data: any, defaultValue: T): T {
    if (data === null || data === undefined || data === '') return defaultValue;
    if (typeof data !== 'string') return data as T;
    try {
        return JSON.parse(data) as T;
    } catch (e) {
        console.error("Error parsing JSON:", e, "Data:", data);
        return defaultValue;
    }
}

export const findContiguousBlock = (activity: Atividade, startDateStr: string) => {
    const schedule = activity.schedule;
    if (!schedule[startDateStr]) return { originalSchedule: {}, length: 0 };

    const sortedDates = Object.keys(schedule)
        .map(d => new Date(d + 'T00:00:00Z'))
        .sort((a, b) => a.getTime() - b.getTime());

    const formattedDates = sortedDates.map(formatDate);
    const startIndex = formattedDates.indexOf(startDateStr);
    if (startIndex === -1) return { originalSchedule: {}, length: 0 };

    let blockStart = startIndex;
    while (blockStart > 0) {
        const current = sortedDates[blockStart];
        const prev = sortedDates[blockStart - 1];
        const diff = (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (diff > 1) break;
        blockStart--;
    }

    let blockEnd = startIndex;
    while (blockEnd < formattedDates.length - 1) {
        const current = sortedDates[blockEnd];
        const next = sortedDates[blockEnd + 1];
        const diff = (next.getTime() - current.getTime()) / (1000 * 60 * 60 * 24);
        if (diff > 1) break;
        blockEnd++;
    }

    const blockDates = formattedDates.slice(blockStart, blockEnd + 1);
    const originalSchedule: Record<string, Status> = {};
    blockDates.forEach(date => {
        originalSchedule[date] = schedule[date];
    });

    return { originalSchedule, length: blockDates.length };
};

export const flattenData = (data: ScheduleData): RenderableRow[] => {
    const rows: RenderableRow[] = [];
    let wbsGroup = 1;
    data.forEach((group, groupIndex) => {
        let renderGroup = true;
        const totalRowsInGroup = group.tarefas.reduce((acc, task) => acc + Math.max(task.activities.length, 1), 0) || 1;
        const groupRowSpan = totalRowsInGroup;
        let wbsTask = 1;

        if (group.tarefas.length === 0) {
            // Group with no tasks
            rows.push({
                group,
                task: { id: group.id + '_placeholder_task', title: '(Sem tarefas)', activities: [] },
                renderGroup,
                groupRowSpan,
                renderTask: true,
                taskRowSpan: 1,
                wbsId: `${wbsGroup}`,
                isLastInGroup: groupIndex === data.length - 1,
                isLastInTask: true
            });
        } else {
            group.tarefas.forEach((task, taskIndex) => {
                let renderTask = true;
                const taskRowSpan = Math.max(task.activities.length, 1);
                let wbsActivity = 1;

                if (task.activities.length === 0) {
                    rows.push({
                        group,
                        task,
                        renderGroup,
                        groupRowSpan,
                        renderTask,
                        taskRowSpan,
                        wbsId: `${wbsGroup}.${wbsTask}`,
                        isLastInGroup: groupIndex === data.length - 1 && taskIndex === group.tarefas.length - 1,
                        isLastInTask: true
                    });
                    renderGroup = false;
                    renderTask = false;
                } else {
                    task.activities.forEach((activity, activityIndex) => {
                        rows.push({
                            group,
                            task,
                            activity,
                            renderGroup,
                            groupRowSpan,
                            renderTask,
                            taskRowSpan,
                            wbsId: `${wbsGroup}.${wbsTask}.${wbsActivity}`,
                            isLastInGroup: groupIndex === data.length - 1 && taskIndex === group.tarefas.length - 1 && activityIndex === task.activities.length - 1,
                            isLastInTask: activityIndex === task.activities.length - 1
                        });
                        renderGroup = false;
                        renderTask = false;
                        wbsActivity++;
                    });
                }
                wbsTask++;
            });
        }
        wbsGroup++;
    });
    return rows;
};