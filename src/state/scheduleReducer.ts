import { ScheduleData, Status } from './types';
import { generateId, deepClone } from '../utils/dataUtils';
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
    | { type: 'ADD_ITEM'; payload: { type: 'group' | 'task' | 'activity'; parentId?: string; date?: string; status?: Status } }
    | { type: 'BATCH_DELETE_ITEMS'; payload: { id: string; type: 'group' | 'task' | 'activity' }[] }
    | { type: 'UPDATE_TEXT'; payload: { id: string; field: string; value: string } }
    | { type: 'UPDATE_STATUS'; payload: { activityId: string; date: string; status: Status | null } }
    | { type: 'BATCH_UPDATE_STATUS'; payload: { activityId: string; date: string; status: Status | null }[] }
    | { type: 'UPDATE_SCHEDULE'; payload: ScheduleData }
    | { type: 'MOVE_GROUP'; payload: { fromId: string, toId: string | null } }
    | { type: 'MOVE_ITEM'; payload: { id: string; type: 'task' | 'activity'; direction: 'up' | 'down' } }
    | { type: 'MOVE_ACTIVITY_DND'; payload: { draggedId: string, targetId: string | null, taskId: string } }
    | { type: 'TOGGLE_HIDE_ACTIVITY'; payload: string }
    | { type: 'TOGGLE_HIDE_ITEM'; payload: { id: string; type: 'group' | 'task' | 'activity' } }
    | { type: 'DUPLICATE_TASK'; payload: { taskId: string } }
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
            const { type, parentId, date, status } = action.payload;
            const initialSchedule = date && status ? { [date]: status } : {};
            const newActivity = { id: generateId(), name: 'Nova Atividade', schedule: initialSchedule };
            const newTask = { id: generateId(), title: 'Nova Tarefa Principal', activities: [newActivity] };
            const newGroup = { id: generateId(), tarefas: [newTask], customValues: {} };

            const newData = (() => {
                if (type === 'group') {
                    return [...(state.liveData || []), newGroup];
                }
                if (type === 'task' && parentId) {
                    return (state.liveData || []).map(group =>
                        group.id === parentId
                            ? { ...group, tarefas: [...(group.tarefas || []), newTask] }
                            : group
                    );
                }
                if (type === 'activity' && parentId) {
                    return (state.liveData || []).map(group => ({
                        ...group,
                        tarefas: (group.tarefas || []).map(task =>
                            task.id === parentId
                                ? { ...task, activities: [...(task.activities || []), newActivity] }
                                : task
                        ),
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
