import { ScheduleData, Status } from './types';
import { generateId, deepClone, getNextWorkingDay } from '../utils/dataUtils';
import { aiDeletionAgent } from '../ai/aiAgents';

// Define the shape of the state managed by the reducer
export interface ScheduleState {
    liveData: ScheduleData;
    history: ScheduleData[];
    historyIndex: number;
}

// Define the actions that can be dispatched
export type ScheduleAction =
    | { type: 'LOAD_DATA'; payload: ScheduleData }
    | { type: 'SET_DATA'; payload: ScheduleData }
    | { type: 'APPEND_DATA'; payload: ScheduleData }
    | { type: 'UNDO' }
    | { type: 'REDO' }
    | { type: 'ADD_ITEM'; payload: { type: 'group' | 'task' | 'activity'; parentId?: string; insertAfterId?: string; date?: string; status?: Status } }
    | { type: 'BATCH_DELETE_ITEMS'; payload: { id: string; type: 'group' | 'task' | 'activity' }[] }
    | { type: 'UPDATE_TEXT'; payload: { id: string; field: string; value: string } }
    | { type: 'UPDATE_STATUS'; payload: { activityId: string; date: string; status: Status | null } }
    | { type: 'UPDATE_ANNOTATION'; payload: { activityId: string; date: string; text: string | null } }
    | { type: 'BATCH_UPDATE_STATUS'; payload: { activityId: string; date: string; status: Status | null }[] }
    | { type: 'UPDATE_SCHEDULE'; payload: ScheduleData }
    | { type: 'MOVE_GROUP'; payload: { fromId: string, toId: string | null } }
    | { type: 'MOVE_ITEM'; payload: { id: string; type: 'task' | 'activity'; direction: 'up' | 'down' } }
    | { type: 'MOVE_TASK_DND'; payload: { draggedId: string, targetGroupId: string, targetId: string | null } }
    | { type: 'MOVE_ACTIVITY_DND'; payload: { draggedId: string, targetId: string | null, taskId: string } }
    | { type: 'TOGGLE_HIDE_ACTIVITY'; payload: string }
    | { type: 'TOGGLE_HIDE_ITEM'; payload: { id: string; type: 'group' | 'task' | 'activity' } }
    | { type: 'DUPLICATE_TASK'; payload: { taskId: string } }
    | { type: 'SHIFT_HOLIDAY'; payload: { holidayDateStr: string; skipWeekends: boolean } }
    | { type: 'INTELLIGENT_RESCHEDULE'; payload: { affectedItems: { activityId: string, taskId: string, dateStr: string }[], selectionMaxDate: string } }
    | { type: 'CLEAR_ALL' };

// The reducer function that handles state transitions
export const scheduleReducer = (state: ScheduleState, action: ScheduleAction): ScheduleState => {
    // Helper to create a new state with history tracking
    const createNewStateWithHistory = (newData: ScheduleData): ScheduleState => {
        const newHistory = [...state.history.slice(0, state.historyIndex + 1), newData];
        return {
            ...state,
            liveData: newData,
            history: newHistory,
            historyIndex: newHistory.length - 1,
        };
    };

    switch (action.type) {
        case 'LOAD_DATA':
            return {
                liveData: action.payload,
                history: [action.payload],
                historyIndex: 0,
            };

        case 'SET_DATA':
            return createNewStateWithHistory(action.payload);

        case 'APPEND_DATA':
            return createNewStateWithHistory([...state.liveData, ...action.payload]);

        case 'CLEAR_ALL':
            return createNewStateWithHistory([]);

        case 'TOGGLE_HIDE_ITEM': {
            const { id, type } = action.payload;
            return createNewStateWithHistory(
                (state.liveData || []).map(group => {
                    if (type === 'group' && group.id === id) {
                        return { ...group, isHidden: !group.isHidden };
                    }
                    return {
                        ...group,
                        tarefas: (group.tarefas || []).map(task => {
                            if (type === 'task' && task.id === id) {
                                return { ...task, isHidden: !task.isHidden };
                            }
                            return {
                                ...task,
                                activities: (task.activities || []).map(act => 
                                    (type === 'activity' && act.id === id) ? { ...act, isHidden: !act.isHidden } : act
                                )
                            };
                        })
                    };
                })
            );
        }

        case 'TOGGLE_HIDE_ACTIVITY': {
            const targetId = action.payload;
            return createNewStateWithHistory(
                (state.liveData || []).map(group => ({
                    ...group,
                    tarefas: (group.tarefas || []).map(task => ({
                        ...task,
                        activities: (task.activities || []).map(act => act.id === targetId ? { ...act, isHidden: !act.isHidden } : act)
                    }))
                }))
            );
        }

        case 'DUPLICATE_TASK': {
            const { taskId } = action.payload;
            const newData = (state.liveData || []).map(group => {
                const taskIndex = group.tarefas.findIndex(t => t.id === taskId);
                if (taskIndex !== -1) {
                    const originalTask = group.tarefas[taskIndex];
                    const duplicatedTask = {
                        ...deepClone(originalTask),
                        id: generateId(),
                        activities: originalTask.activities.map(act => ({
                            ...deepClone(act),
                            id: generateId()
                        }))
                    };
                    const newTarefas = [...group.tarefas];
                    newTarefas.splice(taskIndex + 1, 0, duplicatedTask);
                    return { ...group, tarefas: newTarefas };
                }
                return group;
            });
            return createNewStateWithHistory(newData);
        }

        case 'ADD_ITEM': {
            const { type, parentId, insertAfterId, date, status } = action.payload;
            const initialSchedule = date && status ? { [date]: status } : {};
            const newActivity = { id: generateId(), name: 'Nova Atividade', schedule: initialSchedule, sector: '' };
            const newTask = { id: generateId(), title: 'Nova Tarefa Principal', activities: [newActivity] };
            const newGroup = { id: generateId(), tarefas: [newTask], customValues: {} };

            const newData = (() => {
                if (type === 'group') {
                    if (insertAfterId) {
                        const index = (state.liveData || []).findIndex(g => g.id === insertAfterId);
                        if (index !== -1) {
                            const newArr = [...state.liveData];
                            newArr.splice(index + 1, 0, newGroup);
                            return newArr;
                        }
                    }
                    return [...(state.liveData || []), newGroup];
                }
                if (type === 'task' && parentId) {
                    return (state.liveData || []).map(group => {
                        if (group.id === parentId) {
                            let newTasks = [...(group.tarefas || [])];
                            if (insertAfterId) {
                                const index = newTasks.findIndex(t => t.id === insertAfterId);
                                if (index !== -1) {
                                    newTasks.splice(index + 1, 0, newTask);
                                    return { ...group, tarefas: newTasks };
                                }
                            }
                            return { ...group, tarefas: [...newTasks, newTask] };
                        }
                        return group;
                    });
                }
                if (type === 'activity' && parentId) {
                    return (state.liveData || []).map(group => ({
                        ...group,
                        tarefas: (group.tarefas || []).map(task => {
                            if (task.id === parentId) {
                                let newActivities = [...(task.activities || [])];
                                if (insertAfterId) {
                                    const index = newActivities.findIndex(a => a.id === insertAfterId);
                                    if (index !== -1) {
                                        newActivities.splice(index + 1, 0, newActivity);
                                        return { ...task, activities: newActivities };
                                    }
                                }
                                return { ...task, activities: [...newActivities, newActivity] };
                            }
                            return task;
                        })
                    }));
                }
                return state.liveData;
            })();
            return createNewStateWithHistory(newData);
        }
        
        case 'BATCH_DELETE_ITEMS': {
            const newData = action.payload.reduce(
                (currentData, itemToDelete) => {
                    return aiDeletionAgent(currentData, itemToDelete.id, itemToDelete.type);
                },
                state.liveData
            );
            return createNewStateWithHistory(newData);
        }

        case 'UPDATE_TEXT': {
            const { id, field, value } = action.payload;
            const newData = (state.liveData || []).map(group => {
                // If it's a structural field update for a group
                if (group.id === id && !['tarefa', 'tarefa_fa', 'atividade'].includes(field)) {
                    return { ...group, customValues: { ...group.customValues, [field]: value } };
                }
                
                let taskUpdated = false;
                const newTarefas = (group.tarefas || []).map(tarefa => {
                    if (field === 'tarefa' && tarefa.id === id) {
                        taskUpdated = true;
                        return { ...tarefa, title: value };
                    }
                    if (field === 'tarefa_fa' && tarefa.id === id) {
                        taskUpdated = true;
                        return { ...tarefa, fa: value };
                    }
                    let activityUpdated = false;
                    const newActivities = (tarefa.activities || []).map(activity => {
                        if (field === 'atividade' && activity.id === id) {
                            activityUpdated = true;
                            return { ...activity, name: value };
                        }
                        if (field === 'sector' && activity.id === id) {
                            activityUpdated = true;
                            return { ...activity, sector: value };
                        }
                        return activity;
                    });
                    if (activityUpdated) {
                        taskUpdated = true;
                        return { ...tarefa, activities: newActivities };
                    }
                    return tarefa;
                });
                
                if (taskUpdated) {
                    return { ...group, tarefas: newTarefas };
                }
                return group;
            });
            return createNewStateWithHistory(newData);
        }

        case 'UPDATE_STATUS': {
            const { activityId, date, status } = action.payload;
            const newData = (state.liveData || []).map(group => ({
                ...group,
                tarefas: (group.tarefas || []).map(task => ({
                    ...task,
                    activities: (task.activities || []).map(activity => {
                        if (activity.id === activityId) {
                            const newSchedule = { ...activity.schedule };
                            if (status === null) {
                                delete newSchedule[date];
                            } else {
                                newSchedule[date] = status;
                            }
                            return { ...activity, schedule: newSchedule };
                        }
                        return activity;
                    })
                }))
            }));
            return createNewStateWithHistory(newData);
        }
        case 'UPDATE_ANNOTATION': {
            const { activityId, date, text } = action.payload;
            const newData = (state.liveData || []).map(group => ({
                ...group,
                tarefas: (group.tarefas || []).map(task => ({
                    ...task,
                    activities: (task.activities || []).map(activity => {
                        if (activity.id === activityId) {
                            const newAnnotations = { ...(activity.annotations || {}) };
                            if (text === null || text.trim() === '') {
                                delete newAnnotations[date];
                            } else {
                                newAnnotations[date] = text;
                            }
                            return { ...activity, annotations: newAnnotations };
                        }
                        return activity;
                    })
                }))
            }));
            return createNewStateWithHistory(newData);
        }

        case 'BATCH_UPDATE_STATUS': {
            const updates = action.payload;
            // Create a map for faster lookup if needed, but for simplicity:
            let newData = state.liveData;
            
            // To be more efficient, we can optimize this but let's start with a correct implementation
            newData = (state.liveData || []).map(group => ({
                ...group,
                tarefas: (group.tarefas || []).map(task => ({
                    ...task,
                    activities: (task.activities || []).map(activity => {
                        const activityUpdates = updates.filter(u => u.activityId === activity.id);
                        if (activityUpdates.length > 0) {
                            const newSchedule = { ...activity.schedule };
                            activityUpdates.forEach(u => {
                                if (u.status === null) {
                                    delete newSchedule[u.date];
                                } else {
                                    newSchedule[u.date] = u.status;
                                }
                            });
                            return { ...activity, schedule: newSchedule };
                        }
                        return activity;
                    })
                }))
            }));
            return createNewStateWithHistory(newData);
        }

        case 'UPDATE_SCHEDULE':
             return createNewStateWithHistory(action.payload);
         
        case 'SHIFT_HOLIDAY': {
            const { holidayDateStr, skipWeekends } = action.payload;
            if (!holidayDateStr) return state;

            const newData = (state.liveData || []).map(group => {
                return {
                    ...group,
                    tarefas: (group.tarefas || []).map(task => {
                        return {
                            ...task,
                            activities: (task.activities || []).map(activity => {
                                const newSchedule: Record<string, Status> = {};
                                const newAnnotations: Record<string, string> = {};

                                // Copy unaffected dates (< holidayDateStr)
                                if (activity.schedule) {
                                    Object.entries(activity.schedule).forEach(([dateStr, status]) => {
                                        if (dateStr < holidayDateStr) {
                                            newSchedule[dateStr] = status;
                                        }
                                    });
                                }
                                if (activity.annotations) {
                                    Object.entries(activity.annotations).forEach(([dateStr, note]) => {
                                        if (dateStr < holidayDateStr) {
                                            newAnnotations[dateStr] = note;
                                        }
                                    });
                                }

                                // Collect all affected dates (>= holidayDateStr)
                                const affectedDates = new Set<string>();
                                if (activity.schedule) {
                                    Object.keys(activity.schedule).forEach(dateStr => {
                                        if (dateStr >= holidayDateStr) affectedDates.add(dateStr);
                                    });
                                }
                                if (activity.annotations) {
                                    Object.keys(activity.annotations).forEach(dateStr => {
                                        if (dateStr >= holidayDateStr) affectedDates.add(dateStr);
                                    });
                                }

                                // Sort affected dates in descending order to shift right-to-left without overwriting
                                const sortedAffectedDates = Array.from(affectedDates).sort().reverse();

                                // Shift affected dates
                                sortedAffectedDates.forEach(dateStr => {
                                    const d = new Date(dateStr + 'T00:00:00Z');
                                    if (skipWeekends) {
                                        do {
                                            d.setUTCDate(d.getUTCDate() + 1);
                                        } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
                                    } else {
                                        d.setUTCDate(d.getUTCDate() + 1);
                                    }
                                    const nextDayStr = d.toISOString().split('T')[0];

                                    if (activity.schedule && activity.schedule[dateStr] !== undefined) {
                                        newSchedule[nextDayStr] = activity.schedule[dateStr];
                                    }
                                    if (activity.annotations && activity.annotations[dateStr] !== undefined) {
                                        newAnnotations[nextDayStr] = activity.annotations[dateStr];
                                    }
                                });

                                return {
                                    ...activity,
                                    schedule: newSchedule,
                                    annotations: Object.keys(newAnnotations).length > 0 ? newAnnotations : undefined
                                };
                            })
                        };
                    })
                };
            });

            return createNewStateWithHistory(newData);
        }
        
        case 'INTELLIGENT_RESCHEDULE': {
            const { affectedItems, selectionMaxDate } = action.payload; // array of { activityId, taskId, dateStr }
            if (affectedItems.length === 0) return state;

            const formatDateStr = (date: Date): string => date.toISOString().split('T')[0];

            const addWorkingDays = (startDateStr: string, days: number): string => {
                let d = new Date(startDateStr + 'T00:00:00Z');
                if (days === 0) return startDateStr;
                const step = days > 0 ? 1 : -1;
                const target = Math.abs(days);
                let added = 0;
                while (added < target) {
                    d.setUTCDate(d.getUTCDate() + step);
                    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
                        added++;
                    }
                }
                return formatDateStr(d);
            };

            const getWorkingDaysDiff = (startDateStr: string, endDateStr: string): number => {
                if (startDateStr === endDateStr) return 0;
                let start = new Date(startDateStr + 'T00:00:00Z');
                let end = new Date(endDateStr + 'T00:00:00Z');
                const isReverse = start > end;
                if (isReverse) {
                    const temp = start;
                    start = end;
                    end = temp;
                }
                let diff = 0;
                const curr = new Date(start);
                while (formatDateStr(curr) !== formatDateStr(end)) {
                    curr.setUTCDate(curr.getUTCDate() + 1);
                    if (curr.getUTCDay() !== 0 && curr.getUTCDay() !== 6) {
                        diff++;
                    }
                }
                return isReverse ? -diff : diff;
            };

            // Find the selectionMinDate as the earliest dateStr in the affectedItems
            const selectionMinDate = affectedItems.reduce((min, item) => item.dateStr < min ? item.dateStr : min, affectedItems[0].dateStr);

            // Calculate the delay in working days
            const firstAvailableDate = getNextWorkingDay(selectionMaxDate);
            const delay = getWorkingDaysDiff(selectionMinDate, firstAvailableDate);

            const newData = deepClone(state.liveData);

            // Group by group id to apply changes per group
            for (const group of newData) {
                for (const task of group.tarefas) {
                    const taskAffected = affectedItems.filter(item => item.taskId === task.id);
                    if (taskAffected.length === 0) continue;

                    const affectedActivityIds = new Set(taskAffected.map(item => item.activityId));

                    interface ActivityInfo {
                        activity: any;
                        origPlannedDates: string[];
                        origStart: string | null;
                        origEnd: string | null;
                        offsets: number[];
                        isShifted: boolean;
                        newStart: string | null;
                        newEnd: string | null;
                    }

                    const activityInfos: ActivityInfo[] = task.activities.map((activity: any) => {
                        // Get all dates from selectionMinDate onwards where status is N, C, or X
                        const origPlannedDates = Object.keys(activity.schedule)
                            .filter(d => d >= selectionMinDate && (
                                activity.schedule[d] === Status.NaoRealizado ||
                                activity.schedule[d] === Status.Cancelado ||
                                activity.schedule[d] === Status.Programado
                            ))
                            .sort();

                        const isShifted = affectedActivityIds.has(activity.id);

                        if (origPlannedDates.length === 0) {
                            return {
                                activity,
                                origPlannedDates: [],
                                origStart: null,
                                origEnd: null,
                                offsets: [],
                                isShifted: false,
                                newStart: null,
                                newEnd: null
                            };
                        }

                        const origStart = origPlannedDates[0];
                        const origEnd = origPlannedDates[origPlannedDates.length - 1];
                        const offsets = origPlannedDates.map(d => getWorkingDaysDiff(origStart, d));

                        return {
                            activity,
                            origPlannedDates,
                            origStart,
                            origEnd,
                            offsets,
                            isShifted,
                            newStart: null,
                            newEnd: null
                        };
                    });

                    // Reschedule activity sequences
                    for (let i = 0; i < activityInfos.length; i++) {
                        const info = activityInfos[i];
                        if (info.origPlannedDates.length === 0) continue;

                        // Find the predecessor p < i whose original end date is before this activity's start date
                        let predIndex = -1;
                        let maxOrigEnd: string | null = null;

                        for (let p = 0; p < i; p++) {
                            const predInfo = activityInfos[p];
                            if (predInfo.origPlannedDates.length === 0 || !predInfo.origEnd || !info.origStart) continue;

                            if (predInfo.origEnd < info.origStart) {
                                if (maxOrigEnd === null || predInfo.origEnd > maxOrigEnd) {
                                    maxOrigEnd = predInfo.origEnd;
                                    predIndex = p;
                                }
                            }
                        }

                        if (predIndex !== -1) {
                            const predInfo = activityInfos[predIndex];
                            // If predecessor was shifted, then this activity must shift too
                            if (predInfo.isShifted) {
                                info.isShifted = true;
                                const lag = getWorkingDaysDiff(predInfo.origEnd!, info.origStart!);
                                info.newStart = addWorkingDays(predInfo.newEnd!, lag);
                            } else if (info.isShifted) {
                                info.newStart = addWorkingDays(info.origStart!, delay);
                            } else {
                                info.isShifted = false;
                                info.newStart = info.origStart;
                            }
                        } else {
                            // No predecessor
                            if (info.isShifted) {
                                info.newStart = addWorkingDays(info.origStart!, delay);
                            } else {
                                info.isShifted = false;
                                info.newStart = info.origStart;
                            }
                        }

                        if (info.isShifted && info.newStart) {
                            const lastOffset = info.offsets[info.offsets.length - 1];
                            info.newEnd = addWorkingDays(info.newStart, lastOffset);
                        } else {
                            info.newEnd = info.origEnd;
                        }
                    }

                    // Apply schedule and annotation updates
                    for (const info of activityInfos) {
                        if (info.origPlannedDates.length === 0) continue;

                        if (info.isShifted && info.newStart) {
                            const oldToNewMap = new Map<string, string>();
                            for (let j = 0; j < info.origPlannedDates.length; j++) {
                                const oldDate = info.origPlannedDates[j];
                                const newDate = addWorkingDays(info.newStart, info.offsets[j]);
                                oldToNewMap.set(oldDate, newDate);
                            }

                            const scheduleUpdates: { date: string, status: Status | null }[] = [];
                            const annotationUpdates: { date: string, text: string | null }[] = [];

                            for (const oldDate of info.origPlannedDates) {
                                const isHistoricalNC = oldDate <= selectionMaxDate && (
                                    info.activity.schedule[oldDate] === Status.NaoRealizado ||
                                    info.activity.schedule[oldDate] === Status.Cancelado
                                );

                                if (isHistoricalNC) {
                                    // Keep historical N or C inside selection block
                                } else {
                                    scheduleUpdates.push({ date: oldDate, status: null });
                                    if (info.activity.annotations && info.activity.annotations[oldDate] !== undefined) {
                                        annotationUpdates.push({ date: oldDate, text: null });
                                    }
                                }
                            }

                            for (const oldDate of info.origPlannedDates) {
                                const newDate = oldToNewMap.get(oldDate)!;
                                scheduleUpdates.push({ date: newDate, status: Status.Programado });

                                const isHistoricalNC = oldDate <= selectionMaxDate && (
                                    info.activity.schedule[oldDate] === Status.NaoRealizado ||
                                    info.activity.schedule[oldDate] === Status.Cancelado
                                );

                                if (!isHistoricalNC && info.activity.annotations && info.activity.annotations[oldDate] !== undefined) {
                                    annotationUpdates.push({ date: newDate, text: info.activity.annotations[oldDate] });
                                }
                            }

                            for (const update of scheduleUpdates) {
                                if (update.status === null) {
                                    delete info.activity.schedule[update.date];
                                } else {
                                    info.activity.schedule[update.date] = update.status;
                                }
                            }

                            if (annotationUpdates.length > 0) {
                                if (!info.activity.annotations) {
                                    info.activity.annotations = {};
                                }
                                for (const update of annotationUpdates) {
                                    if (update.text === null) {
                                        delete info.activity.annotations[update.date];
                                    } else {
                                        info.activity.annotations[update.date] = update.text;
                                    }
                                }
                                if (Object.keys(info.activity.annotations).length === 0) {
                                    delete info.activity.annotations;
                                }
                            }
                        }
                    }
                }
            }

            return createNewStateWithHistory(newData);
        }

        case 'MOVE_GROUP': {
            const { fromId, toId } = action.payload;
            const data = [...state.liveData];
            const fromIndex = data.findIndex(g => g.id === fromId);
            if (fromIndex === -1) return state;

            const [movedGroup] = data.splice(fromIndex, 1);
            
            if (toId === null) {
                data.push(movedGroup);
            } else {
                const toIndex = data.findIndex(g => g.id === toId);
                if (toIndex === -1) return state;
                data.splice(toIndex, 0, movedGroup);
            }
            return createNewStateWithHistory(data);
        }

        case 'MOVE_TASK_DND': {
            const { draggedId, targetGroupId, targetId } = action.payload;

            let sourceGroupIdx = -1;
            let sourceTaskIdx = -1;
            const data = deepClone(state.liveData || []);

            // Find the task to extract
            for (let gIdx = 0; gIdx < data.length; gIdx++) {
                const tIdx = data[gIdx].tarefas.findIndex((t: any) => t.id === draggedId);
                if (tIdx !== -1) {
                    sourceGroupIdx = gIdx;
                    sourceTaskIdx = tIdx;
                    break;
                }
            }

            if (sourceGroupIdx === -1) return state;

            // Extract the task
            const [draggedTask] = data[sourceGroupIdx].tarefas.splice(sourceTaskIdx, 1);

            // Find target group
            const targetGroupIdx = data.findIndex((g: any) => g.id === targetGroupId);
            if (targetGroupIdx === -1) {
                // Return task if group not found
                data[sourceGroupIdx].tarefas.splice(sourceTaskIdx, 0, draggedTask);
                return state;
            }

            let targetTaskIdx = data[targetGroupIdx].tarefas.length;
            if (targetId) {
                const idx = data[targetGroupIdx].tarefas.findIndex((t: any) => t.id === targetId);
                if (idx !== -1) {
                    targetTaskIdx = idx;
                }
            }

            data[targetGroupIdx].tarefas.splice(targetTaskIdx, 0, draggedTask);
            
            return createNewStateWithHistory(data);
        }

        case 'MOVE_ITEM': {
            const { id, type, direction } = action.payload;
            const newData = deepClone(state.liveData || []);

            if (type === 'task') {
                let foundGroupIdx = -1;
                let foundTaskIdx = -1;

                for (let gIdx = 0; gIdx < newData.length; gIdx++) {
                    const tIdx = newData[gIdx].tarefas.findIndex((t: any) => t.id === id);
                    if (tIdx !== -1) {
                        foundGroupIdx = gIdx;
                        foundTaskIdx = tIdx;
                        break;
                    }
                }

                if (foundGroupIdx === -1) return state;

                if (direction === 'up') {
                    if (foundTaskIdx > 0) {
                        // Swap within the same group
                        const temp = newData[foundGroupIdx].tarefas[foundTaskIdx - 1];
                        newData[foundGroupIdx].tarefas[foundTaskIdx - 1] = newData[foundGroupIdx].tarefas[foundTaskIdx];
                        newData[foundGroupIdx].tarefas[foundTaskIdx] = temp;
                    } else if (foundGroupIdx > 0) {
                        // Move to previous group
                        const [movedTask] = newData[foundGroupIdx].tarefas.splice(foundTaskIdx, 1);
                        newData[foundGroupIdx - 1].tarefas.push(movedTask);
                    } else {
                        return state; // Already at top
                    }
                } else {
                    if (foundTaskIdx < newData[foundGroupIdx].tarefas.length - 1) {
                        // Swap within the same group
                        const temp = newData[foundGroupIdx].tarefas[foundTaskIdx + 1];
                        newData[foundGroupIdx].tarefas[foundTaskIdx + 1] = newData[foundGroupIdx].tarefas[foundTaskIdx];
                        newData[foundGroupIdx].tarefas[foundTaskIdx] = temp;
                    } else if (foundGroupIdx < newData.length - 1) {
                        // Move to next group
                        const [movedTask] = newData[foundGroupIdx].tarefas.splice(foundTaskIdx, 1);
                        newData[foundGroupIdx + 1].tarefas.unshift(movedTask);
                    } else {
                        return state; // Already at bottom
                    }
                }
                
                return createNewStateWithHistory(newData);

            } else if (type === 'activity') {
                let foundGroupIdx = -1;
                let foundTaskIdx = -1;
                let foundActIdx = -1;

                for (let gIdx = 0; gIdx < newData.length; gIdx++) {
                    for (let tIdx = 0; tIdx < newData[gIdx].tarefas.length; tIdx++) {
                        const aIdx = newData[gIdx].tarefas[tIdx].activities.findIndex((a: any) => a.id === id);
                        if (aIdx !== -1) {
                            foundGroupIdx = gIdx;
                            foundTaskIdx = tIdx;
                            foundActIdx = aIdx;
                            break;
                        }
                    }
                    if (foundGroupIdx !== -1) break;
                }

                if (foundGroupIdx === -1) return state;

                if (direction === 'up') {
                    if (foundActIdx > 0) {
                        // Swap within same task
                        const temp = newData[foundGroupIdx].tarefas[foundTaskIdx].activities[foundActIdx - 1];
                        newData[foundGroupIdx].tarefas[foundTaskIdx].activities[foundActIdx - 1] = newData[foundGroupIdx].tarefas[foundTaskIdx].activities[foundActIdx];
                        newData[foundGroupIdx].tarefas[foundTaskIdx].activities[foundActIdx] = temp;
                    } else {
                        // Move to previous task globally
                        let prevTIdx = foundTaskIdx - 1;
                        let prevGIdx = foundGroupIdx;
                        
                        if (prevTIdx < 0) {
                            prevGIdx--;
                            if (prevGIdx >= 0) {
                                prevTIdx = newData[prevGIdx].tarefas.length - 1;
                            }
                        }

                        if (prevGIdx >= 0 && prevTIdx >= 0) {
                            const [movedAct] = newData[foundGroupIdx].tarefas[foundTaskIdx].activities.splice(foundActIdx, 1);
                            newData[prevGIdx].tarefas[prevTIdx].activities.push(movedAct);
                        } else {
                            return state; // Already at top of everything
                        }
                    }
                } else {
                    if (foundActIdx < newData[foundGroupIdx].tarefas[foundTaskIdx].activities.length - 1) {
                        // Swap within same task
                        const temp = newData[foundGroupIdx].tarefas[foundTaskIdx].activities[foundActIdx + 1];
                        newData[foundGroupIdx].tarefas[foundTaskIdx].activities[foundActIdx + 1] = newData[foundGroupIdx].tarefas[foundTaskIdx].activities[foundActIdx];
                        newData[foundGroupIdx].tarefas[foundTaskIdx].activities[foundActIdx] = temp;
                    } else {
                        // Move to next task globally
                        let nextTIdx = foundTaskIdx + 1;
                        let nextGIdx = foundGroupIdx;
                        
                        if (nextTIdx >= newData[foundGroupIdx].tarefas.length) {
                            nextGIdx++;
                            if (nextGIdx < newData.length) {
                                nextTIdx = 0;
                            }
                        }

                        if (nextGIdx < newData.length && nextTIdx < newData[nextGIdx].tarefas.length) {
                            const [movedAct] = newData[foundGroupIdx].tarefas[foundTaskIdx].activities.splice(foundActIdx, 1);
                            newData[nextGIdx].tarefas[nextTIdx].activities.unshift(movedAct);
                        } else {
                            return state; // Already at bottom of everything
                        }
                    }
                }

                return createNewStateWithHistory(newData);
            }
            return state;
        }

        case 'MOVE_ACTIVITY_DND': {
            const { draggedId, targetId, taskId } = action.payload;
            
            let hasChanged = false;
            const newData = (state.liveData || []).map(group => {
                let groupChanged = false;
                const newTarefas = (group.tarefas || []).map(task => {
                    if (task.id !== taskId) return task;
                    
                    const draggedIndex = task.activities.findIndex(a => a.id === draggedId);
                    if (draggedIndex === -1) return task;

                    const newActivities = [...task.activities];
                    const [draggedActivity] = newActivities.splice(draggedIndex, 1);
                    
                    let targetIndex = newActivities.length; // Default to end if target is null
                    if (targetId) {
                        targetIndex = newActivities.findIndex(a => a.id === targetId);
                        if (targetIndex === -1) targetIndex = newActivities.length; // Fallback
                    }

                    newActivities.splice(targetIndex, 0, draggedActivity);
                    
                    groupChanged = true;
                    hasChanged = true;
                    return { ...task, activities: newActivities };
                });
                return groupChanged ? { ...group, tarefas: newTarefas } : group;
            });
            
            if (!hasChanged) return state;
            return createNewStateWithHistory(newData);
        }

        case 'UNDO': {
            if (state.historyIndex <= 0) return state;
            const newIndex = state.historyIndex - 1;
            return {
                ...state,
                historyIndex: newIndex,
                liveData: state.history[newIndex],
            };
        }

        case 'REDO': {
            if (state.historyIndex >= state.history.length - 1) return state;
            const newIndex = state.historyIndex + 1;
            return {
                ...state,
                historyIndex: newIndex,
                liveData: state.history[newIndex],
            };
        }

        default:
            return state;
    }
};
