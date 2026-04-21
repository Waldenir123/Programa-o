import { ScheduleData, Status } from './types';
import { generateId } from '../utils/dataUtils';
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
    | { type: 'ADD_ITEM'; payload: { type: 'group' | 'task' | 'activity'; parentId?: string } }
    | { type: 'BATCH_DELETE_ITEMS'; payload: { id: string; type: 'group' | 'task' | 'activity' }[] }
    | { type: 'UPDATE_TEXT'; payload: { id: string; field: string; value: string } }
    | { type: 'UPDATE_STATUS'; payload: { activityId: string; date: string; status: Status | null } }
    | { type: 'BATCH_UPDATE_STATUS'; payload: { activityId: string; date: string; status: Status | null }[] }
    | { type: 'UPDATE_SCHEDULE'; payload: ScheduleData }
    | { type: 'MOVE_GROUP'; payload: { fromId: string, toId: string | null } }
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

        case 'ADD_ITEM': {
            const { type, parentId } = action.payload;
            const newActivity = { id: generateId(), name: 'Nova Atividade', schedule: {} };
            const newTask = { id: generateId(), title: 'Nova Tarefa Principal', activities: [newActivity] };
            const newGroup = { id: generateId(), tarefas: [newTask], customValues: {} };

            const newData = (() => {
                if (type === 'group') {
                    return [...state.liveData, newGroup];
                }
                if (type === 'task' && parentId) {
                    return state.liveData.map(group =>
                        group.id === parentId
                            ? { ...group, tarefas: [...group.tarefas, newTask] }
                            : group
                    );
                }
                if (type === 'activity' && parentId) {
                    return state.liveData.map(group => ({
                        ...group,
                        tarefas: group.tarefas.map(task =>
                            task.id === parentId
                                ? { ...task, activities: [...task.activities, newActivity] }
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
            const newData = state.liveData.map(group => {
                // If it's a structural field update for a group
                if (group.id === id && !['tarefa', 'tarefa_fa', 'atividade'].includes(field)) {
                    return { ...group, customValues: { ...group.customValues, [field]: value } };
                }
                
                let taskUpdated = false;
                const newTarefas = group.tarefas.map(tarefa => {
                    if (field === 'tarefa' && tarefa.id === id) {
                        taskUpdated = true;
                        return { ...tarefa, title: value };
                    }
                    if (field === 'tarefa_fa' && tarefa.id === id) {
                        taskUpdated = true;
                        return { ...tarefa, fa: value };
                    }
                    let activityUpdated = false;
                    const newActivities = tarefa.activities.map(activity => {
                        if (field === 'atividade' && activity.id === id) {
                            activityUpdated = true;
                            return { ...activity, name: value };
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
            const newData = state.liveData.map(group => ({
                ...group,
                tarefas: group.tarefas.map(task => ({
                    ...task,
                    activities: task.activities.map(activity => {
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
            newData = state.liveData.map(group => ({
                ...group,
                tarefas: group.tarefas.map(task => ({
                    ...task,
                    activities: task.activities.map(activity => {
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
