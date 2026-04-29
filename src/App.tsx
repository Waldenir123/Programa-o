import React, { useState, useMemo, useCallback, useEffect, useRef, useReducer } from 'react';
import { GoogleGenAI } from "@google/genai";
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, doc, query, where, onSnapshot, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}
interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

// Test Firebase connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// State and Types
import { scheduleReducer } from './state/scheduleReducer';
import { 
    Project, UserProjects, Page, SelectedItem, ScheduleData, ToastMessage, RenderableRow, Status, Atividade,
    PREDEFINED_MANPOWER_ROLES, STATUS_LABELS, STATUS_COLOR_MAP, DynamicColumn 
} from './state/types';

// Hooks
import { useScheduleInteraction } from './hooks/useScheduleInteraction';

// Utils
import { formatDate, getWeek, generateId, deepClone, flattenData, safeJsonParse } from './utils/dataUtils';
import { parseTabularData } from './utils/parsers';
import { exportToExcelAgent, exportToPdfAgent } from './utils/exportAgents';

// AI Agents
import { parseScheduleWithAI, parseFADetailWithAI, analyzeDeletionImpactWithAI, aiDeletionAgent } from './ai/aiAgents';

// Components
import { ToastContainer } from './components/Toast';
import { AuthScreen } from './components/AuthScreen';
import { ImportModal, LoadModal, SaveModal, DeletionModal, PrintScheduleModal } from './components/Modals';
import { Sidebar } from './components/Sidebar';
import { TutorialModal } from './components/Modals';
import { FilterDropdown } from './components/FilterDropdown';
import { ScheduleHeader, ScheduleBody } from './components/ScheduleTable';
import { ComparisonView } from './components/ComparisonView';
import { DashboardView } from './components/DashboardView';
import { ManpowerAllocationView } from './components/ManpowerAllocationView';
import { DailyAllocationView } from './components/DailyAllocationView';
import { ManpowerDashboardView } from './components/ManpowerDashboardView';
import { DailySummaryView } from './components/DailySummaryView';
import { MachineListView } from './components/MachineListView';
import { DailyMachineAllocationView } from './components/DailyMachineAllocationView';

  const createNewProject = (name: string, obra: string): Project => ({
  id: generateId(),
  name,
  obra,
  lastModified: Date.now(),
  title: 'Nova Programação Semanal',
  startDate: formatDate(new Date('2026-04-13T00:00:00Z')),
  programmerName: 'Não definido',
  liveData: [],
  dynamicColumns: [],
  savedPlan: null,
  manpowerAllocation: {
    roles: [...PREDEFINED_MANPOWER_ROLES],
    hasSecondShift: false,
    data: {
        adm: {},
        shift2: {}
    }
  },
  dailyManpowerAllocation: {},
  machines: [],
  dailyMachineAllocation: {}
});

export const App = () => {
  // --- STATE MANAGEMENT ---
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const [scheduleState, dispatch] = useReducer(scheduleReducer, {
      liveData: [],
      history: [[]],
      historyIndex: 0,
  });
  const { liveData, history, historyIndex } = scheduleState;
  
  const [summaryState, dispatchSummary] = useReducer(scheduleReducer, {
      liveData: [],
      history: [[]],
      historyIndex: 0,
  });
  const summaryData = summaryState.liveData;
  
  const [activeFilters, setActiveFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<{ column: string; rect: DOMRect } | null>(null);
  const [showHiddenActivities, setShowHiddenActivities] = useState(false);
  
  const [isImportModalOpen, setImportModalOpen] = useState(false);

  const handleToggleHideActivity = useCallback((id: string) => {
      dispatch({ type: 'TOGGLE_HIDE_ACTIVITY', payload: id });
  }, []);
  const [isLoadModalOpen, setLoadModalOpen] = useState(false);
  const [isSaveModalOpen, setisSaveModalOpen] = useState(false);
  const [isDeletionModalOpen, setDeletionModalOpen] = useState(false);
  const [isPrintModalOpen, setPrintModalOpen] = useState(false);
  const [isTutorialModalOpen, setTutorialModalOpen] = useState(false);

  // Global monitoring of machine allocations across all projects for conflict detection
  const allMachineAllocationsGlobal = useMemo(() => {
    const allocations: Record<string, Record<string, { projectId: string, projectName: string }[]>> = {};
    Object.values(projects as any).forEach((proj: any) => {
      if (!proj.dailyMachineAllocation) return;
      Object.entries(proj.dailyMachineAllocation as Record<string, any>).forEach(([activityId, dates]) => {
        Object.entries(dates as Record<string, any>).forEach(([date, machineIds]) => {
          (machineIds as string[]).forEach(mId => {
            if (!allocations[mId]) allocations[mId] = {};
            if (!allocations[mId][date]) allocations[mId][date] = [];
            allocations[mId][date].push({ projectId: proj.id, projectName: proj.name });
          });
        });
      });
    });
    return allocations;
  }, [projects]);
  const [weeksToPrint, setWeeksToPrint] = useState(4);
  const [orientation, setOrientation] = useState<'p' | 'l'>('l');
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileNavVisible, setIsMobileNavVisible] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('schedule');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  
  const [draggedGroupInfo, setDraggedGroupInfo] = useState<{ group: ScheduleData[0], index: number } | null>(null);
  const [draggedActivityInfo, setDraggedActivityInfo] = useState<{ activity: Atividade, taskId: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Column resizing and zoom state
  const [fixedColumnWidths, setFixedColumnWidths] = useState<number[]>([50, 130, 280, 250]);
  const [comparisonFixedColumnWidths, setComparisonFixedColumnWidths] = useState<number[]>([50, 130, 280, 250, 80]);
  const [zoomLevels, setZoomLevels] = useState<Record<Page, number>>({
      schedule: 135,
      dashboard: 100,
      comparison: 100,
      manpower: 125,
      dailyAllocation: 90,
      manpowerDashboard: 90,
      machines: 100,
      dailyMachineAllocation: 90,
      dailySummary: 100,
  });
  const [resizingInfo, setResizingInfo] = useState({ isResizing: false, columnIndex: null as number | null, startX: 0, startWidth: 0 });
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
      'ID': true,
      'Fase/Agrupador': true,
      'TAREFA PRINCIPAL': true,
      'ATIVIDADE': true,
  });
  
  const gridRef = useRef<HTMLDivElement>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(0);
  
  const quickImportInputRef = useRef<HTMLInputElement>(null);
  const excelImportInputRef = useRef<HTMLInputElement>(null);

  // --- DERIVED STATE FROM activeProject ---
  const savedPlan = useMemo(() => activeProject?.savedPlan || null, [activeProject]);
  const title = useMemo(() => activeProject?.title || '', [activeProject]);
  const [currentStartDate, setCurrentStartDate] = useState(() => activeProject?.startDate ? new Date(activeProject.startDate + 'T00:00:00Z') : new Date('2026-04-13T00:00:00Z'));
  const [goToWeekInput, setGoToWeekInput] = useState(() => getWeek(currentStartDate));
  const dates = useMemo(() => Array.from({length: 28}, (_, i) => { const d = new Date(currentStartDate); d.setUTCDate(currentStartDate.getUTCDate() + i); return d; }), [currentStartDate]);

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
      setToasts(currentToasts => [
          ...currentToasts,
          { id: nextToastId.current++, message, type }
      ]);
  }, []);
  
  const filteredData = useMemo(() => {
    const filters = activeFilters as Record<string, Set<string>>;
    const hasActiveFilters = Object.values(filters).some(s => s && s.size > 0);

    if (!liveData) {
        return [];
    }

    // Apply showHiddenActivities and hasActiveFilters
    let groupsFiltered = (liveData || []).map(group => {
        const filteredTarefas = (group.tarefas || []).map(task => {
            const actSelections = filters['atividade'];
            const isAtividadeFilterActive = actSelections && actSelections.size > 0;
            
            const filteredActivities = (task.activities || []).filter(act => {
                if (isAtividadeFilterActive) {
                    // If filter is active and name is selected, ALWAYS show it. Otherwise hide it.
                    return actSelections.has(act.name);
                }
                
                // If no filter on atividade, behave normally regarding hidden
                if (act.isHidden && !showHiddenActivities) return false;
                
                return true;
            });
            return { ...task, activities: filteredActivities };
        });
        return { ...group, tarefas: filteredTarefas };
    });

    if (hasActiveFilters) {
        // Group-level structural filters
        groupsFiltered = groupsFiltered.filter(group => {
            for (const [colId, selections] of Object.entries(filters)) {
                if (selections && selections.size > 0) {
                    if (colId === 'tarefaPrincipal' || colId === 'atividade') continue;
                    const value = group.customValues?.[colId] || '';
                    if (!selections.has(value)) return false;
                }
            }
            return true;
        });

        // Tarefa Principal filter
        if (filters['tarefaPrincipal']?.size) {
            groupsFiltered = (groupsFiltered || [])
                .map(group => ({
                    ...group,
                    tarefas: (group.tarefas || []).filter(task => filters.tarefaPrincipal.has(task.title)),
                }))
        }
    }

    // Cleanup empty groups if not showing them. We keep groups if they have at least one valid tarefa.
    // If showHiddenActivities is false, we might want to hide tasks with 0 activities unless task itself matches filter? 
    // Usually it's okay to just show tasks that have 0 activities if it's structural.
    
    return groupsFiltered;
  }, [liveData, activeFilters, showHiddenActivities]);

  const renderableRows = useMemo(() => flattenData(filteredData), [filteredData]);

  const {
      activeCell,
      handleCellMouseDown,
      handleCellMouseEnter,
      handleCellRightClick,
      selectionBlock,
      cutSelectionBlock,
      isMovingBlock,
      ghostBlockCells
  } = useScheduleInteraction(liveData, dispatch, renderableRows, dates, addToast);

  const ai = useMemo(() => {
    if (!process.env.GEMINI_API_KEY) {
        console.error("A chave de API para o Gemini não está configurada.");
        return null;
    }
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }, []);

  useEffect(() => {
    if (activeProject?.startDate) {
        const newDate = new Date(activeProject.startDate + 'T00:00:00Z');
        if (newDate.getTime() !== currentStartDate.getTime()){
            setCurrentStartDate(newDate);
        }
    }
  }, [activeProject?.startDate]);
  
  useEffect(() => {
      setGoToWeekInput(getWeek(currentStartDate));
  }, [currentStartDate]);

  // --- AUTH & PROJECT MANAGEMENT ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isAuthReady || !currentUser) {
       setProjects({});
       return;
    }
    const q = query(collection(db, 'projects'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const newProjects: Record<string, Project> = {};
        let needsInitialLoad = false;
        snapshot.docs.forEach(docSnap => {
           let data = docSnap.data();
           
           // Automatically migrate old default date to new 2026 default date
           if (data.startDate === '2025-07-14') {
               data.startDate = '2026-04-13';
               // Let's also update the database asynchronously
               setDoc(doc(db, 'projects', docSnap.id), { startDate: '2026-04-13' }, { merge: true }).catch(err => console.error(err));
           }

            // Data Migration for Dynamic Columns
            let liveData = safeJsonParse(data.liveData, []);
            let dynamicColumns = safeJsonParse(data.dynamicColumns, [
                { id: 'fa', name: 'Fase/Agrupador', width: 120 }
            ]);
            
            // Remove obsolete columns if they exist
            dynamicColumns = dynamicColumns.filter((c: any) => 
                !c.name.toUpperCase().includes('COMPONENTE') && 
                !c.name.toUpperCase().includes('SETOR')
            );

            // Migrate Grupo structure if needed
            liveData = (liveData || []).map((g: any) => {
                if (!g.customValues) {
                    const customValues: Record<string, string> = {};
                    if (g.fa) customValues['fa'] = g.fa;
                    return { ...g, customValues, fa: undefined };
                }
                return g;
            });

           newProjects[docSnap.id] = {
               ...data,
               liveData: liveData,
               dynamicColumns: dynamicColumns,
               savedPlan: safeJsonParse(data.savedPlan, null),
               summaryData: safeJsonParse(data.summaryData, null),
               manpowerAllocation: safeJsonParse(data.manpowerAllocation, { roles: PREDEFINED_MANPOWER_ROLES, hasSecondShift: false, data: { adm: {}, shift2: {} } }),
               dailyManpowerAllocation: safeJsonParse(data.dailyManpowerAllocation, {}),
               machines: safeJsonParse(data.machines, []),
               dailyMachineAllocation: safeJsonParse(data.dailyMachineAllocation, {}),
               displaySettings: safeJsonParse(data.displaySettings, undefined)
           } as Project;
        });
        setProjects((prev) => {
           if (Object.keys(prev).length === 0 && Object.keys(newProjects).length > 0) needsInitialLoad = true;
           return newProjects;
        });
        
        if (needsInitialLoad && !activeProject) {
            const lastActiveId = localStorage.getItem(`pcp-lastActive-${currentUser.uid}`);
            const projectToLoad = newProjects[lastActiveId!];
            if (projectToLoad) {
                setActiveProject(projectToLoad);
                dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
            } else if (Object.keys(newProjects).length > 0) {
                 setLoadModalOpen(true);
            }
        }
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'projects');
    });
    return unsubscribe;
  }, [currentUser, isAuthReady, activeProject]);

  const handleLogout = async () => {
    await signOut(auth);
    setActiveProject(null);
  };

  const persistProjectToFirebase = async (project: Project) => {
    try {
      const dbProject = {
        ...project,
        liveData: JSON.stringify(project.liveData),
        savedPlan: project.savedPlan ? JSON.stringify(project.savedPlan) : '',
        summaryData: project.summaryData ? JSON.stringify(project.summaryData) : '',
        manpowerAllocation: JSON.stringify(project.manpowerAllocation),
        dailyManpowerAllocation: JSON.stringify(project.dailyManpowerAllocation),
        machines: JSON.stringify(project.machines || []),
        dailyMachineAllocation: JSON.stringify(project.dailyMachineAllocation || {}),
        displaySettings: project.displaySettings ? JSON.stringify(project.displaySettings) : ''
      };
      await setDoc(doc(db, 'projects', project.id), dbProject);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'projects/' + project.id);
    }
  };

  const handleNewProject = async (name: string, obra: string) => {
    if (!currentUser) return;
    if (!name.trim()) {
        addToast("O nome do projeto não pode ser vazio.", "error");
        return;
    }
    const newProject = createNewProject(name, obra);
    newProject.ownerId = currentUser.uid;
    
    setActiveProject(newProject);
    dispatch({ type: 'LOAD_DATA', payload: newProject.liveData });
    dispatchSummary({ type: 'LOAD_DATA', payload: newProject.liveData });
    localStorage.setItem(`pcp-lastActive-${currentUser.uid}`, newProject.id);
    setisSaveModalOpen(false);
    
    await persistProjectToFirebase(newProject);
    addToast(`Projeto '${name}' criado com sucesso!`, 'success');
  };
  
  const handleSaveProject = useCallback(async () => {
    if (!currentUser || !activeProject) return;
    
    // Convert Set filters to array for serialization
    const serializableFilters: Record<string, string[]> = {};
    Object.entries(activeFilters).forEach(([key, set]) => {
      serializableFilters[key] = Array.from((set as any) || []);
    });

    const projectToSave = { 
        ...activeProject, 
        liveData, 
        lastModified: Date.now(),
        displaySettings: {
            visibleColumns,
            activeFilters: serializableFilters as any
        }
    };
    setActiveProject(projectToSave); 
    await persistProjectToFirebase(projectToSave);
    addToast(`Projeto '${projectToSave.name}' salvo!`, 'success');
  }, [currentUser, activeProject, liveData, addToast, visibleColumns, activeFilters]);

  const handleLoadProject = useCallback((projectId: string) => {
    if (!currentUser) return;
    const projectToLoad = projects[projectId];
    if (projectToLoad) {
        if (projectToLoad.manpowerAllocation && !(projectToLoad.manpowerAllocation.data as any)?.adm) {
            const oldData = projectToLoad.manpowerAllocation.data as unknown as any;
            projectToLoad.manpowerAllocation.data = {
                adm: oldData || {},
                shift2: {}
            };
            projectToLoad.manpowerAllocation.hasSecondShift = false;
        }

        if (!projectToLoad.dailyManpowerAllocation) {
            projectToLoad.dailyManpowerAllocation = {};
        }
        setActiveProject(projectToLoad);
        if (projectToLoad.startDate) {
            setCurrentStartDate(new Date(projectToLoad.startDate + 'T00:00:00Z'));
        }
        dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
        dispatchSummary({ type: 'LOAD_DATA', payload: projectToLoad.summaryData || projectToLoad.liveData });
        localStorage.setItem(`pcp-lastActive-${currentUser.uid}`, projectId);
        setLoadModalOpen(false);

        // Load display settings
        if (projectToLoad.displaySettings) {
          if (projectToLoad.displaySettings.visibleColumns) {
            setVisibleColumns(projectToLoad.displaySettings.visibleColumns);
          }
          if (projectToLoad.displaySettings.activeFilters) {
            const restoredFilters: Record<string, Set<string>> = {};
            Object.entries(projectToLoad.displaySettings.activeFilters).forEach(([key, arr]) => {
              restoredFilters[key] = new Set(arr as unknown as string[]);
            });
            setActiveFilters(restoredFilters);
          }
        }

        addToast(`Projeto '${projectToLoad.name}' carregado.`, 'success');
    }
  }, [currentUser, projects, addToast]);
  
  const handleDeleteProject = async (projectId: string) => {
    if (!currentUser) return;
    const deletedProjectName = projects[projectId]?.name || 'Projeto';
    try {
        await deleteDoc(doc(db, 'projects', projectId));
        addToast(`Projeto '${deletedProjectName}' excluído.`, 'success');
        if (activeProject?.id === projectId) {
            const nextProject = Object.values(projects as Record<string, Project>).filter(p => p.id !== projectId).sort((a,b) => b.lastModified - a.lastModified)[0];
            if (nextProject) {
                handleLoadProject(nextProject.id);
            } else {
                 setActiveProject(null);
                 localStorage.removeItem(`pcp-lastActive-${currentUser.uid}`);
            }
        }
    } catch(err) {
        handleFirestoreError(err, OperationType.DELETE, 'projects/' + projectId);
    }
  };
  
  const handleRenameProject = async (id: string, newName: string) => {
    if (!currentUser) return;
    try {
      await setDoc(doc(db, 'projects', id), { name: newName, lastModified: Date.now() }, { merge: true });
      addToast(`Projeto renomeado para '${newName}'`, 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projects/' + id);
    }
  };

  const handleDuplicateProject = async (id: string) => {
    const project = projects[id];
    if (!project || !currentUser) return;
    
    const duplicatedProject = {
      ...deepClone(project),
      id: generateId(),
      name: `${project.name} (Cópia)`,
      lastModified: Date.now(),
      ownerId: currentUser.uid
    };

    await persistProjectToFirebase(duplicatedProject);
    addToast(`Projeto '${project.name}' duplicado com sucesso!`, 'success');
  };

  const handleRenameFolder = async (oldName: string, newName: string) => {
    const projectsInFolder = Object.values(projects as Record<string, Project>).filter(p => (p.obra || 'Geral') === oldName);
    
    if (projectsInFolder.length === 0) {
      addToast("Nenhum projeto encontrado para renomear.", "error");
      return;
    }

    try {
      await Promise.all(projectsInFolder.map(project => 
        setDoc(doc(db, 'projects', project.id), { obra: newName, lastModified: Date.now() }, { merge: true })
      ));
      addToast(`Pasta '${oldName}' renomeada para '${newName}'`, 'success');
    } catch (err) {
      console.error(`Falha ao renomear pasta:`, err);
      addToast("Erro ao renomear alguns projetos da pasta.", "error");
    }
  };

  const handleDeleteFolder = async (folderName: string) => {
    const projectsInFolder = Object.values(projects as Record<string, Project>).filter(p => (p.obra || 'Geral') === folderName);
    
    if (projectsInFolder.length === 0) {
      addToast("Nenhum projeto encontrado para excluir.", "error");
      return;
    }

    try {
      await Promise.all(projectsInFolder.map(project => 
        deleteDoc(doc(db, 'projects', project.id))
      ));
      addToast(`Pasta '${folderName}' e seus ${projectsInFolder.length} arquivos foram excluídos.`, 'success');
    } catch (err) {
      console.error(`Falha ao excluir pasta:`, err);
      addToast("Erro ao excluir alguns projetos da pasta.", "error");
    }
  };

  const handleUndo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const handleRedo = useCallback(() => dispatch({ type: 'REDO' }), []);
  
  const handleTextUpdate = useCallback((id: string, field: string, value: string) => {
    if (field === 'title' && activeProject) {
        setActiveProject(p => p ? { ...p, title: value, lastModified: Date.now() } : null);
        return;
    }
    
    if (field === 'programmerName' && activeProject) {
        setActiveProject(p => p ? { ...p, programmerName: value, lastModified: Date.now() } : null);
        return;
    }

    if (field === 'name' && activeProject) {
        setActiveProject(p => p ? { ...p, name: value, lastModified: Date.now() } : null);
        return;
    }
    
    dispatch({ type: 'UPDATE_TEXT', payload: { id, field: field as any, value } });
  }, [activeProject]);

  const handleSummaryTextUpdate = useCallback((id: string, field: string, value: string) => {
    dispatchSummary({ type: 'UPDATE_TEXT', payload: { id, field: field as any, value } });
  }, []);

  const handleSummaryAddItem = useCallback((type: 'group' | 'task' | 'activity', parentId?: string) => {
    dispatchSummary({ type: 'ADD_ITEM', payload: { type, parentId } });
  }, []);

  const handleSummaryDeleteItem = useCallback((id: string, type: 'group' | 'task' | 'activity') => {
    dispatchSummary({ type: 'BATCH_DELETE_ITEMS', payload: [{ id, type }] });
  }, []);

  useEffect(() => {
    if (activeProject && (activeProject.liveData !== liveData || activeProject.summaryData !== summaryData)) {
        setActiveProject(prev => prev ? { ...prev, liveData, summaryData, lastModified: Date.now() } : null);
    }
  }, [liveData, summaryData]);
  
  const handleSavePlan = useCallback(async () => {
    if (!activeProject || !currentUser) return;
    if (liveData.length === 0) {
        addToast("Não é possível definir um cronograma vazio como base.", "error");
        return;
    }
    if (window.confirm("Deseja salvar o estado atual como o novo 'Planejamento Base'? Esta ação substituirá o plano anterior.")) {
      const projectWithSavedPlan = { ...activeProject, savedPlan: deepClone(liveData), lastModified: Date.now() };
      setActiveProject(projectWithSavedPlan);
      await persistProjectToFirebase(projectWithSavedPlan);
      addToast("Planejamento base definido com sucesso!", 'success');
    }
  }, [activeProject, currentUser, addToast, liveData]);

  const handleAddItem = useCallback((type: 'group' | 'task' | 'activity', parentId?: string) => {
      dispatch({ type: 'ADD_ITEM', payload: { type, parentId } });
  }, []);

  const handleMoveItem = useCallback((id: string, direction: 'up' | 'down') => {
      dispatch({ type: 'MOVE_ACTIVITY', payload: { id, direction } });
  }, []);

  const handleConfirmDeletion = useCallback(async (itemsToDelete: { id: string, type: 'group' | 'task' | 'activity' }[]) => {
    if (!activeProject) return;

    // 1. Calculate new grid data locally (DEFINITIVE SOURCE)
    const nextLiveData = itemsToDelete.reduce(
        (acc, item) => aiDeletionAgent(acc, item.id, item.type),
        liveData
    );

    // 2. Identify all activities to be removed (for allocation cleanup)
    const activitiesToRemove = new Set<string>();
    itemsToDelete.forEach(item => {
        const targetId = String(item.id).trim();
        if (item.type === 'activity') {
            activitiesToRemove.add(targetId);
        } else {
            liveData.forEach(g => {
                if (item.type === 'group' && String(g.id).trim() === targetId) {
                    g.tarefas.forEach(t => (t.activities || []).forEach(a => activitiesToRemove.add(String(a.id).trim())));
                } else if (item.type === 'task') {
                    g.tarefas.forEach(t => {
                        if (String(t.id).trim() === targetId) {
                            (t.activities || []).forEach(a => activitiesToRemove.add(String(a.id).trim()));
                        }
                    });
                }
            });
        }
    });

    // 3. Dispatch to reducer (History & Grid Update)
    dispatch({ type: 'SET_DATA', payload: nextLiveData });

    // 4. Update project metadata (Allocations) and Persist
    const newManpower = { ...(activeProject.dailyManpowerAllocation || {}) };
    const newMachines = { ...(activeProject.dailyMachineAllocation || {}) };
    activitiesToRemove.forEach(id => {
        delete newManpower[id];
        delete newMachines[id];
    });

    const updatedProject: Project = {
        ...activeProject,
        liveData: nextLiveData,
        dailyManpowerAllocation: newManpower,
        dailyMachineAllocation: newMachines,
        lastModified: Date.now()
    };

    setActiveProject(updatedProject);
    await persistProjectToFirebase(updatedProject);

    const message = itemsToDelete.length > 1
        ? `${itemsToDelete.length} itens excluídos.`
        : `Item excluído.`;
    addToast(message, 'success');
    setSelectedItems([]);
  }, [activeProject, liveData, dispatch, persistProjectToFirebase, addToast]);

  const handleDeleteSelectedItems = useCallback(() => {
    if (selectedItems.length === 0) return;
    setDeletionModalOpen(true);
  }, [selectedItems]);

  const handleClearAll = useCallback(async () => {
    if (!activeProject) return;
    if (window.confirm("Esta ação vai apagar COMPLETAMENTE os dados deste projeto. Deseja continuar?")) {
        // Reducer update
        dispatch({ type: 'CLEAR_ALL' });
        
        // Persistence update
        const updatedProject: Project = {
          ...activeProject,
          liveData: [],
          dailyManpowerAllocation: {},
          dailyMachineAllocation: {},
          lastModified: Date.now()
        };
        setActiveProject(updatedProject);
        await persistProjectToFirebase(updatedProject);
        
        setSelectedItems([]);
        addToast("Cronograma limpo com sucesso e salvo.", "success");
    }
  }, [activeProject, persistProjectToFirebase, addToast, dispatch]);
  
  const handleImportSchedule = useCallback(async (text: string, file: File | null) => {
    if (!ai) {
        addToast("A chave de API para o Gemini não está configurada.", "error");
        return;
    }
    try {
        let fileData: { mimeType: string, data: string } | null = null;
        if (file) {
            fileData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (!result) return reject(new Error("Não foi possível ler o arquivo."));
                    resolve({ mimeType: file.type, data: result.split(',')[1] });
                };
                reader.onerror = (error) => reject(error);
                reader.readAsDataURL(file);
            });
        }
        const importedData = await parseScheduleWithAI(ai, text, fileData);
        dispatch({ type: 'SET_DATA', payload: importedData });
        setImportModalOpen(false);
        addToast("Cronograma importado com sucesso!", "success");
    } catch (error) {
        addToast(`Falha ao importar: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [ai, addToast, dispatch]);

  const handleQuickImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ai) {
      addToast("A chave de API para o Gemini não está configurada.", "error");
      return;
    }
    
    addToast(`Processando o arquivo '${file.name}' com a IA...`, 'success');

    try {
        const fileData = await new Promise<{ mimeType: string, data: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result as string;
                if (!result) return reject(new Error("Não foi possível ler o arquivo."));
                resolve({ mimeType: file.type, data: result.split(',')[1] });
            };
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });

        const importedData = await parseScheduleWithAI(ai, '', fileData); // Pass empty text
        dispatch({ type: 'SET_DATA', payload: importedData });
        addToast("Cronograma importado com sucesso!", "success");
    } catch (error) {
        addToast(`Falha ao importar: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
        if (event.target) {
            event.target.value = '';
        }
    }
  }, [ai, addToast, dispatch]);

  const handleImportExcelFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm("Isto substituirá o cronograma atual. Deseja continuar?")) {
        if (event.target) event.target.value = '';
        return;
    }
    
    addToast(`Processando o arquivo Excel '${file.name}'...`, 'success');
    
    try {
        const data = await file.arrayBuffer();
        const { read } = await import("xlsx");
        const workbook = read(data, { cellDates: true });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const { utils } = await import("xlsx");
        const jsonData: any[][] = utils.sheet_to_json(worksheet, { header: 1 });
        
        const importedData = parseTabularData(jsonData); 
        
        dispatch({ type: 'SET_DATA', payload: importedData });
        addToast("Cronograma importado do Excel com sucesso!", "success");
    } catch (error) {
        addToast(`Falha ao importar do Excel: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
        if (event.target) event.target.value = '';
    }
  }, [addToast]);

  const handleImportFA = useCallback(async (text: string, file: File | null) => {
    if (!ai) {
        addToast("A chave de API para o Gemini não está configurada.", "error");
        return;
    }
    if (!file && !text) {
        addToast("Por favor, selecione um arquivo de imagem da FA ou cole o texto.", "error");
        return;
    }
    try {
        let fileData: { mimeType: string, data: string } | null = null;
        if (file) {
            fileData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (!result) return reject(new Error("Não foi possível ler o arquivo."));
                    resolve({ mimeType: file.type, data: result.split(',')[1] });
                };
                reader.onerror = (error) => reject(error);
                reader.readAsDataURL(file);
            });
        }
        
        const importedGroups = await parseFADetailWithAI(ai, text, fileData);

        const hydratedData = importedGroups.map(group => ({
            ...group,
            id: generateId(),
            tarefas: Array.isArray(group.tarefas) ? group.tarefas.map(tarefa => ({
                ...tarefa,
                id: generateId(),
                activities: Array.isArray(tarefa.activities) ? tarefa.activities.map(activity => ({
                    ...activity,
                    id: generateId(),
                    schedule: {} // Add empty schedule
                })) : []
            })) : []
        }));

        dispatch({ type: 'APPEND_DATA', payload: hydratedData });
        setImportModalOpen(false);
        addToast("FA importada com sucesso e adicionada ao cronograma!", "success");

    } catch (error) {
        addToast(`Falha na importação da FA: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [ai, addToast, dispatch]);
  
  useEffect(() => {
      const handlePaste = async (event: ClipboardEvent) => {
          const target = event.target as HTMLElement;
          if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
              return;
          }

          const text = event.clipboardData?.getData('text/plain');
          if (!text) return;

          event.preventDefault();
          
          try {
              const rows = text.split(/\r?\n/).filter(row => row.trim() !== '').map(row => row.split('\t'));
              const pastedData = parseTabularData(rows);
              
              if (pastedData.length > 0) {
                  dispatch({ type: 'APPEND_DATA', payload: pastedData });
                  addToast(`${pastedData.length} grupos colados com sucesso!`, "success");
              }
          } catch (error) {
              addToast(`Falha ao colar dados: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
      };

      window.addEventListener('paste', handlePaste);
      return () => {
          window.removeEventListener('paste', handlePaste);
      };
  }, [addToast]);

  const handleOpenFilter = useCallback((column: string, rect: DOMRect) => {
      setOpenFilter({ column, rect });
  }, []);

  const handleCloseFilter = useCallback(() => {
      setOpenFilter(null);
  }, []);

  const handleApplyFilter = useCallback((column: string, selections: Set<string>) => {
      setActiveFilters(prev => ({
          ...prev,
          [column]: selections
      }));
      setOpenFilter(null);
      setSelectedItems([]); // Deselect when filters change
  }, []);
  
  const filterOptions = useMemo(() => {
    const options: Record<string, string[]> = { tarefaPrincipal: [], atividade: [] };
    if (!activeProject) return options;
    
    activeProject.dynamicColumns.forEach(col => {
        options[col.id] = [];
    });

    liveData.forEach(group => {
        activeProject.dynamicColumns.forEach(col => {
            const val = group.customValues?.[col.id];
            if (val && !options[col.id].includes(val)) {
                options[col.id].push(val);
            }
        });
        group.tarefas.forEach(task => {
            if (task.title && !options.tarefaPrincipal.includes(task.title)) {
                options.tarefaPrincipal.push(task.title);
            }
            task.activities.forEach(act => {
                if (act.name && !options.atividade.includes(act.name)) {
                    options.atividade.push(act.name);
                }
            });
        });
    });

    Object.keys(options).forEach(key => {
        options[key].sort();
    });

    return options;
  }, [liveData, activeProject?.dynamicColumns]);

  const handleDateChange = useCallback((newDateStr: string) => {
    const newDate = new Date(newDateStr + 'T00:00:00Z');
    if (isNaN(newDate.getTime())) {
        addToast("Data de início inválida.", "error");
        return;
    }
    setCurrentStartDate(newDate);
    if(activeProject){
        setActiveProject(p => p ? { ...p, startDate: newDateStr } : null);
    }
  }, [activeProject, addToast]);

  const handleExportExcel = () => {
    if (!activeProject) return;
    exportToExcelAgent(filteredData, dates, activeProject, activeProject.dynamicColumns, visibleColumns);
  };
  
  const handleConfirmPrint = () => {
    if (!activeProject) return;
    if (weeksToPrint <= 0) {
        addToast("O número de semanas deve ser maior que zero.", "error");
        return;
    }
    const printDates = Array.from({ length: weeksToPrint * 7 }, (_, i) => {
        const d = new Date(currentStartDate);
        d.setUTCDate(currentStartDate.getUTCDate() + i);
        return d;
    });
    exportToPdfAgent(filteredData, printDates, activeProject, orientation, activeProject.dynamicColumns, visibleColumns);
    setPrintModalOpen(false);
  };
  
  const scheduleHeaders = useMemo(() => {
    const dynamicCols = activeProject?.dynamicColumns || [];
    const beforeNames = dynamicCols.filter(c => c.position !== 'after').map(col => col.name);
    const afterNames = dynamicCols.filter(c => c.position === 'after').map(col => col.name);
    return ['ID', ...beforeNames, 'TAREFA PRINCIPAL', ...afterNames, 'ATIVIDADE'];
  }, [activeProject?.dynamicColumns]);

  const comparisonHeaders = useMemo(() => {
    const dynamicCols = activeProject?.dynamicColumns || [];
    const beforeNames = dynamicCols.filter(c => c.position !== 'after').map(col => col.name);
    const afterNames = dynamicCols.filter(c => c.position === 'after').map(col => col.name);
    return ['ID', ...beforeNames, 'TAREFA PRINCIPAL', ...afterNames, 'ATIVIDADE', 'PLANO'];
  }, [activeProject?.dynamicColumns]);
  const headers = currentPage === 'comparison' ? comparisonHeaders : scheduleHeaders;

  const handleGoToWeek = useCallback(() => {
    if (!goToWeekInput || goToWeekInput < 1 || goToWeekInput > 53) {
        addToast("Por favor, insira um número de semana válido (1-53).", "error");
        return;
    }
    const year = currentStartDate.getUTCFullYear();
    const d = new Date(Date.UTC(year, 0, 1 + (goToWeekInput - 1) * 7));
    const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(d.setUTCDate(diff));
    handleDateChange(formatDate(monday));
  }, [goToWeekInput, currentStartDate, handleDateChange, addToast]);

  const handleGroupDragStart = useCallback((group: ScheduleData[0], index: number) => {
      setDraggedGroupInfo({ group, index });
  }, []);
  
  const handleGroupDrop = useCallback(() => {
    if (draggedGroupInfo === null || dropTargetId === undefined) {
      handleDragEnd();
      return;
    }
    if (draggedGroupInfo.group.id === dropTargetId) {
      handleDragEnd();
      return;
    }
    dispatch({ type: 'MOVE_GROUP', payload: { fromId: draggedGroupInfo.group.id, toId: dropTargetId } });
    handleDragEnd();
  }, [draggedGroupInfo, dropTargetId]);

  const handleActivityDragStart = useCallback((activity: Atividade, taskId: string) => {
    setDraggedActivityInfo({ activity, taskId });
  }, []);

  const handleActivityDrop = useCallback((targetTaskId: string, targetActivityId: string | null) => {
    if (!draggedActivityInfo) {
      handleDragEnd();
      return;
    }
    if (draggedActivityInfo.taskId !== targetTaskId) {
      // Only move within the same task as requested
      handleDragEnd();
      return;
    }
    if (draggedActivityInfo.activity.id === targetActivityId) {
      handleDragEnd();
      return;
    }
    dispatch({ type: 'MOVE_ACTIVITY_DND', payload: { draggedId: draggedActivityInfo.activity.id, targetId: targetActivityId, taskId: targetTaskId } });
    handleDragEnd();
  }, [draggedActivityInfo]);
  
  const handleDragEnd = useCallback(() => {
      setDraggedGroupInfo(null);
      setDraggedActivityInfo(null);
      setDropTargetId(null);
  }, []);
  
  const handleRowClick = useCallback((event: React.MouseEvent, item: SelectedItem) => {
    const isCtrlPressed = event.ctrlKey || event.metaKey;
    setSelectedItems(prev => {
        const isAlreadySelected = prev.some(s => s.id === item.id);
        if (isCtrlPressed) {
            if (isAlreadySelected) {
                return prev.filter(s => s.id !== item.id);
            } else {
                return [...prev, item];
            }
        } else {
            if (isAlreadySelected && prev.length === 1) {
                return [];
            }
            return [item];
        }
    });
  }, []);
  
  // Column resizing and zoom logic
    const effectiveDateColumnWidth = useMemo(() => {
        const currentZoom = zoomLevels[currentPage] || 100;
        return 60 * (currentZoom / 100);
    }, [zoomLevels, currentPage]);

    const scheduleTableColumnWidths = useMemo(() => [
        ...fixedColumnWidths.map((w, i) => visibleColumns[scheduleHeaders[i]] === false ? 0 : w),
        ...Array(dates.length).fill(effectiveDateColumnWidth)
    ], [fixedColumnWidths, dates.length, effectiveDateColumnWidth, visibleColumns, scheduleHeaders]);

    const comparisonTableColumnWidths = useMemo(() => [
        ...comparisonFixedColumnWidths.map((w, i) => visibleColumns[comparisonHeaders[i]] === false ? 0 : w),
        ...Array(dates.length).fill(effectiveDateColumnWidth)
    ], [comparisonFixedColumnWidths, dates.length, effectiveDateColumnWidth, visibleColumns, comparisonHeaders]);

    const stickyColumnPositions = useMemo(() => {
        const currentWidths = currentPage === 'comparison' ? comparisonTableColumnWidths : scheduleTableColumnWidths;
        const positions = [0];
        for (let i = 0; i < headers.length; i++) {
            positions.push(positions[i] + currentWidths[i]);
        }
        return positions;
    }, [scheduleTableColumnWidths, comparisonTableColumnWidths, currentPage, headers.length]);

    // --- COLUMN MANAGEMENT HANDLERS ---
  const handleColumnNameUpdate = useCallback((colId: string, name: string) => {
    setActiveProject(prev => {
        if (!prev) return null;
        return {
            ...prev,
            dynamicColumns: (prev.dynamicColumns || []).map(c => c.id === colId ? { ...c, name } : c)
        }
    });
  }, []);

  const handleAddColumn = useCallback((position: 'before' | 'after' = 'before') => {
    setActiveProject(prev => {
        if (!prev) return null;
        const newCol: DynamicColumn = { id: generateId(), name: 'Nova Coluna', width: 100, position };
        const newDynamicCols = [...prev.dynamicColumns, newCol];
        
        // Re-sort effectively by filtering or just leave it as is if header handles order?
        // Actually, App.tsx's header order depends on position filter.
        // But setFixedColumnWidths needs to insert at correct absolute index in fixedColumnWidths.
        
        let insertIndex = 1; // After ID
        const beforeCols = newDynamicCols.filter(c => c.position !== 'after');
        const afterCols = newDynamicCols.filter(c => c.position === 'after');
        
        if (position === 'before') {
            insertIndex = beforeCols.length; // after existing beforeCols
        } else {
            insertIndex = 1 + beforeCols.length + 1 + afterCols.findIndex(c => c.id === newCol.id); // After ID, beforeCols, and Tarefa Principal
        }
        
        setFixedColumnWidths(prevWidths => {
            const newWidths = [...prevWidths];
            newWidths.splice(insertIndex, 0, 100);
            return newWidths;
        });

        return {
            ...prev,
            dynamicColumns: newDynamicCols,
        }
    });
  }, []);

  const handleRemoveColumn = useCallback((colId: string) => {
    setActiveProject(prev => {
        if (!prev) return null;
        const beforeNames = prev.dynamicColumns.filter(c => c.position !== 'after');
        const colToRemove = prev.dynamicColumns.find(c => c.id === colId);
        if (!colToRemove) return prev;
        
        const isBefore = colToRemove.position !== 'after';
        const innerIdx = (isBefore ? beforeNames : prev.dynamicColumns.filter(c => c.position === 'after')).findIndex(c => c.id === colId);
        const absoluteIdx = isBefore ? (1 + innerIdx) : (1 + beforeNames.length + 1 + innerIdx);

        const newCols = prev.dynamicColumns.filter(c => c.id !== colId);
        setFixedColumnWidths(widths => {
            const newWidths = [...widths];
            newWidths.splice(absoluteIdx, 1);
            return newWidths;
        });
        
        return {
            ...prev,
            dynamicColumns: newCols,
        }
    });
  }, []);

  const handleMoveColumn = useCallback((colId: string, direction: 'left' | 'right') => {
    setActiveProject(prev => {
        if (!prev) return null;
        const idx = prev.dynamicColumns.findIndex(c => c.id === colId);
        if (idx === -1) return prev;

        const newCols = [...prev.dynamicColumns];
        if (direction === 'left' && idx > 0) {
            [newCols[idx - 1], newCols[idx]] = [newCols[idx], newCols[idx - 1]];
            setFixedColumnWidths(widths => {
                const newWidths = [...widths];
                [newWidths[idx], newWidths[idx + 1]] = [newWidths[idx + 1], newWidths[idx]];
                return newWidths;
            });
        } else if (direction === 'right' && idx < newCols.length - 1) {
            [newCols[idx], newCols[idx + 1]] = [newCols[idx + 1], newCols[idx]];
            setFixedColumnWidths(widths => {
                const newWidths = [...widths];
                [newWidths[idx + 1], newWidths[idx + 2]] = [newWidths[idx + 2], newWidths[idx + 1]];
                return newWidths;
            });
        }
        return { ...prev, dynamicColumns: newCols };
    });
  }, []);

  const handleResizeStart = useCallback((columnIndex: number, e: React.MouseEvent) => {
        e.preventDefault();
        const isComparison = currentPage === 'comparison';
        const currentWidths = isComparison ? comparisonFixedColumnWidths : fixedColumnWidths;
        setResizingInfo({
            isResizing: true,
            columnIndex,
            startX: e.clientX,
            startWidth: currentWidths[columnIndex]
        });
    }, [fixedColumnWidths, comparisonFixedColumnWidths, currentPage]);

    const handleResize = useCallback((e: MouseEvent) => {
        if (!resizingInfo.isResizing || resizingInfo.columnIndex === null) return;
        
        const setWidths = currentPage === 'comparison' ? setComparisonFixedColumnWidths : setFixedColumnWidths;
        
        const dx = e.clientX - resizingInfo.startX;
        const newWidth = Math.max(30, resizingInfo.startWidth + dx);
        
        setWidths(currentWidths => {
            const newWidths = [...currentWidths];
            newWidths[resizingInfo.columnIndex!] = newWidth;
            return newWidths;
        });
    }, [resizingInfo, currentPage]);

    const handleResizeEnd = useCallback(() => {
        setResizingInfo({ isResizing: false, columnIndex: null, startX: 0, startWidth: 0 });
    }, []);

    useEffect(() => {
        if (resizingInfo.isResizing) {
            document.body.classList.add('dragging');
            window.addEventListener('mousemove', handleResize);
            window.addEventListener('mouseup', handleResizeEnd);
        }
        return () => {
            document.body.classList.remove('dragging');
            window.removeEventListener('mousemove', handleResize);
            window.removeEventListener('mouseup', handleResizeEnd);
        };
    }, [resizingInfo.isResizing, handleResize, handleResizeEnd]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Ignorar se estiver digitando em um input ou contenteditable
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return;
        }

        const isCtrl = e.ctrlKey || e.metaKey;

        // Desfazer / Refazer
        if (isCtrl && e.key === 'z') {
            e.preventDefault();
            handleUndo();
        } else if (isCtrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            handleRedo();
        }

        // Atalhos de preenchimento de status (1, 2, 3, 4) e limpar (Delete/Backspace)
        if (selectionBlock) {
            let status: Status | null | undefined = undefined;
            if (e.key === '1') status = Status.Realizado;
            else if (e.key === '2') status = Status.Programado;
            else if (e.key === '3') status = Status.Cancelado;
            else if (e.key === '4') status = Status.NaoRealizado;
            else if (e.key === 'Delete' || e.key === 'Backspace') status = null;

            if (status !== undefined) {
                e.preventDefault();
                const activityIdToRowIndex = new Map(
                    (renderableRows || [])
                        .filter(r => r.activity)
                        .map((r, i) => [r.activity!.id, renderableRows.indexOf(r)])
                );
                const datesStr = (dates || []).map(d => formatDate(d));
                const dateToColIndex = new Map((datesStr || []).map((d, i) => [d, i]));

                const anchorRow = activityIdToRowIndex.get(selectionBlock.anchor.activityId);
                const anchorCol = dateToColIndex.get(selectionBlock.anchor.date);
                const endRow = activityIdToRowIndex.get(selectionBlock.end.activityId);
                const endCol = dateToColIndex.get(selectionBlock.end.date);

                if (anchorRow !== undefined && anchorCol !== undefined && endRow !== undefined && endCol !== undefined) {
                    const minRow = Math.min(anchorRow as number, endRow as number);
                    const maxRow = Math.max(anchorRow as number, endRow as number);
                    const minCol = Math.min(anchorCol as number, endCol as number);
                    const maxCol = Math.max(anchorCol as number, endCol as number);

                    const updates: { activityId: string; date: string; status: Status | null }[] = [];
                    const allActivityIds = Array.from(activityIdToRowIndex.keys());
                    for (let r = minRow; r <= maxRow; r++) {
                        const activityId = allActivityIds[r];
                        if (!activityId) continue;
                        for (let c = minCol; c <= maxCol; c++) {
                            const date = datesStr[c];
                            if (date) {
                                updates.push({ activityId: activityId as string, date: date as string, status: status as Status | null });
                            }
                        }
                    }
                    if (updates.length > 0) {
                        dispatch({ type: 'BATCH_UPDATE_STATUS', payload: updates });
                    }
                }
            }
        } else if (e.key === 'Backspace' && !e.shiftKey && selectedItems.length > 0) {
            // Limpar o texto dos itens selecionados
            if ((e.target as HTMLElement).isContentEditable || ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
            e.preventDefault();
            selectedItems.forEach(item => {
                if (item.type === 'activity') {
                    dispatch({ type: 'UPDATE_TEXT', payload: { id: item.id, field: 'atividade', value: '' } });
                } else if (item.type === 'task') {
                    dispatch({ type: 'UPDATE_TEXT', payload: { id: item.id, field: 'tarefa', value: '' } });
                } else if (item.type === 'group') {
                    dispatch({ type: 'UPDATE_TEXT', payload: { id: item.id, field: 'grupo', value: '' } });
                }
            });
            addToast(`${selectedItems.length} textos apagados.`, 'success');
        } else if ((e.key === 'Delete' || (e.shiftKey && e.key === 'Backspace')) && selectedItems.length > 0) {
            // Excluir itens selecionados se não houver bloco de seleção de células
            if ((e.target as HTMLElement).isContentEditable || ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
            e.preventDefault();
            handleDeleteSelectedItems();
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionBlock, liveData, activeProject?.dates, handleUndo, handleRedo]);

  if (!isAuthReady) {
    return <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh',fontSize:'1.2rem',color:'#64748b'}}>Carregando...</div>;
  }
  if (!currentUser) {
    return <AuthScreen />;
  }

  return (
    <div className={`app-wrapper ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <ToastContainer toasts={toasts} setToasts={setToasts} />
      <input type="file" ref={quickImportInputRef} onChange={handleQuickImport} style={{ display: 'none' }} accept="image/*,application/pdf" />
      <input type="file" ref={excelImportInputRef} onChange={handleImportExcelFile} style={{ display: 'none' }} accept=".xlsx, .xls" />
      {isImportModalOpen && <ImportModal isOpen={isImportModalOpen} onClose={() => setImportModalOpen(false)} onImportSchedule={handleImportSchedule} onImportFA={handleImportFA} />}
      {isLoadModalOpen && (
          <LoadModal 
            schedules={Object.values(projects || {})} 
            onLoad={handleLoadProject} 
            onDelete={handleDeleteProject}
            onRenameProject={handleRenameProject}
            onDuplicateProject={handleDuplicateProject}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onClose={() => setLoadModalOpen(false)} 
            isAdmin={true} 
          />
      )}
      {isSaveModalOpen && <SaveModal onClose={() => setisSaveModalOpen(false)} onSave={handleNewProject} currentName={activeProject?.name} currentObra={activeProject?.obra} />}
      {isDeletionModalOpen && <DeletionModal isOpen={isDeletionModalOpen} onClose={() => setDeletionModalOpen(false)} selectedItems={selectedItems} onConfirm={handleConfirmDeletion} ai={ai} data={liveData} addToast={addToast}/>}
      {isPrintModalOpen && <PrintScheduleModal isOpen={isPrintModalOpen} onClose={() => setPrintModalOpen(false)} onConfirm={handleConfirmPrint} weeksToPrint={weeksToPrint} setWeeksToPrint={setWeeksToPrint} orientation={orientation} setOrientation={setOrientation}/>}
      {openFilter && <FilterDropdown columnKey={openFilter.column} allOptions={filterOptions[openFilter.column as keyof typeof filterOptions]} activeSelections={activeFilters[openFilter.column] || new Set()} onApply={handleApplyFilter} onClose={handleCloseFilter} position={openFilter.rect}/>}
      
      {!activeProject ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100%', backgroundColor: '#f8fafc' }}>
               <span className="material-icons" style={{ fontSize: '64px', color: '#94a3b8', marginBottom: '16px' }}>inventory_2</span>
               <h1 style={{ color: '#334155', marginBottom: '8px' }}>Nenhum projeto selecionado</h1>
               <p style={{ color: '#64748b', marginBottom: '24px' }}>Crie um novo planejamento ou abra um projeto existente para começar.</p>
               <div style={{ display: 'flex', gap: '16px' }}>
                    <button className="submit-button" onClick={() => setisSaveModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '1rem' }}>
                        <span className="material-icons">add_box</span> Novo Projeto
                    </button>
                    <button className="control-button" onClick={() => setLoadModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '1rem', backgroundColor: '#fbbf24', border: 'none', color: '#1e293b', fontWeight: 'bold' }}>
                        <span className="material-icons">folder_open</span> Abrir Projeto
                    </button>
               </div>
               <button className="control-button" onClick={handleLogout} style={{ marginTop: '48px' }}>
                    <span className="material-icons" style={{ fontSize: '16px' }}>logout</span> Sair da Conta
               </button>
          </div>
      ) : (
      <div className="app-content">
        <div className="app-header">
           <div className="header-left">
            <button className="sidebar-toggle-btn" onClick={() => setIsMobileNavVisible(!isMobileNavVisible)} aria-label="Menu Mobile">
                <span className="material-icons">menu</span>
            </button>
            <button className="sidebar-toggle control-button" onClick={() => setSidebarCollapsed(!isSidebarCollapsed)} aria-label="Alternar barra lateral">
                <span className="material-icons">{isSidebarCollapsed ? 'menu_open' : 'menu'}</span>
            </button>
            <h1 contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'title', e.currentTarget.textContent || '')}>{title}</h1>
            <nav className="header-nav">
                <button className={`nav-tab`} style={{ backgroundColor: '#fbbf24', color: '#1e293b', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '8px' }} onClick={() => setLoadModalOpen(true)}>
                    <span className="material-icons" style={{ fontSize: '18px' }}>folder_open</span> Abrir Projeto
                </button>
                <button className={`nav-tab ${currentPage === 'schedule' ? 'active' : ''}`} onClick={() => setCurrentPage('schedule')}>Programação</button>
                <button className={`nav-tab ${currentPage === 'dailySummary' ? 'active' : ''}`} onClick={() => setCurrentPage('dailySummary')}>Resumo Diário</button>
                <button className={`nav-tab ${currentPage === 'manpower' ? 'active' : ''}`} onClick={() => setCurrentPage('manpower')}>Quantitativo de MO</button>
                <button className={`nav-tab ${currentPage === 'dailyAllocation' ? 'active' : ''}`} onClick={() => setCurrentPage('dailyAllocation')}>Alocação Diária de MO</button>
                <button className={`nav-tab ${currentPage === 'machines' ? 'active' : ''}`} onClick={() => setCurrentPage('machines')}>Máquinas</button>
                <button className={`nav-tab ${currentPage === 'dailyMachineAllocation' ? 'active' : ''}`} onClick={() => setCurrentPage('dailyMachineAllocation')}>Alocação de Máquina</button>
                <button className={`nav-tab ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => setCurrentPage('dashboard')}>Dashboard</button>
                <button className={`nav-tab ${currentPage === 'manpowerDashboard' ? 'active' : ''}`} onClick={() => setCurrentPage('manpowerDashboard')}>Dashboard de MO</button>
                <button className={`nav-tab ${currentPage === 'comparison' ? 'active' : ''}`} onClick={() => setCurrentPage('comparison')} disabled={!savedPlan}>Comparativo</button>
            </nav>
           </div>
           <div className="header-controls">
                <div className="zoom-control">
                    <span className="material-icons">zoom_out</span>
                    <input 
                        type="range" 
                        min="25" 
                        max="200" 
                        step="5"
                        value={zoomLevels[currentPage] || 100} 
                        onChange={e => setZoomLevels(prev => ({...prev, [currentPage]: Number(e.target.value)}))}
                        aria-label="Zoom do cronograma"
                    />
                    <span className="material-icons">zoom_in</span>
                    <span className="zoom-percentage">{zoomLevels[currentPage] || 100}%</span>
                </div>
                <div className="header-item-editable">
                    <span className="label">Responsável:</span>
                    <span className="editable-field" contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'programmerName', e.currentTarget.textContent || '')}>{activeProject?.programmerName}</span>
                </div>
                <div className="user-info">
                    <span className="material-icons">account_circle</span>
                    <span>{currentUser.displayName || currentUser.email}</span>
                </div>
                <button className="control-button" onClick={handleLogout} aria-label="Sair"><span className="material-icons">logout</span></button>
            </div>
        </div>
        <div className="app-container">
            <div className="sidebar-overlay" onClick={() => setIsMobileNavVisible(false)}></div>
            {(!isSidebarCollapsed || isMobileNavVisible) && (
              <Sidebar 
                handleUndo={handleUndo} handleRedo={handleRedo} historyIndex={historyIndex} historyLength={history.length}
                handleSavePlan={handleSavePlan}
                setImportModalOpen={setImportModalOpen} setSaveModalOpen={setisSaveModalOpen} setLoadModalOpen={setLoadModalOpen}
                handleSaveProject={handleSaveProject}
                handleExportExcel={handleExportExcel} onExportPdfClick={() => setPrintModalOpen(true)}
                handleOpenTutorial={() => setTutorialModalOpen(true)}
                handleDateChange={handleDateChange} startDate={currentStartDate}
                goToWeekInput={goToWeekInput} setGoToWeekInput={setGoToWeekInput} handleGoToWeek={handleGoToWeek}
                selectedItems={selectedItems} handleDeleteSelectedItems={handleDeleteSelectedItems} handleClearAll={handleClearAll}
                handleQuickImportClick={() => quickImportInputRef.current?.click()}
                onImportExcelClick={() => excelImportInputRef.current?.click()}
                visibleColumns={visibleColumns}
                toggleColumnVisibility={(col) => setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }))}
                onCloseMobile={() => setIsMobileNavVisible(false)}
              />
            )}
            <main className="main-content" ref={gridRef}>
              {!activeProject ? (
                <div className="no-project-view">
                    <span className="material-icons" style={{ fontSize: '4rem', color: '#94a3b8' }}>folder_off</span>
                    <h2>Nenhum Projeto Ativo</h2>
                    <p>Crie um novo projeto ou carregue um existente para começar.</p>
                </div>
              ) : (
                <>
                  {currentPage === 'schedule' && (
                    <div className="table-wrapper">
                      <div className="project-detail-header" style={{ display: 'flex', gap: '24px', padding: '16px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', marginBottom: '8px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Obra / Projeto</label>
                            <div contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'name', e.currentTarget.textContent || '')} style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b', borderBottom: '1px dashed #cbd5e1', paddingBottom: '2px' }}>{activeProject.name}</div>
                        </div>
                        <div style={{ width: '200px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Programador</label>
                            <div contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'programmerName', e.currentTarget.textContent || '')} style={{ fontWeight: '500', color: '#334155', borderBottom: '1px dashed #cbd5e1' }}>{activeProject.programmerName || 'Não definido'}</div>
                        </div>
                        <div style={{ width: '200px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Última Atualização</label>
                            <div style={{ color: '#64748b' }}>{new Date(activeProject.lastModified).toLocaleString('pt-BR')}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                onClick={() => setShowHiddenActivities(prev => !prev)}
                                className="control-button"
                                style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: showHiddenActivities ? '#e0e7ff' : '#f1f5f9', color: showHiddenActivities ? '#4338ca' : '#475569', border: '1px solid', borderColor: showHiddenActivities ? '#818cf8' : '#cbd5e1', height: 'fit-content' }}
                                title={showHiddenActivities ? "Ocultar atividades invisíveis" : "Mostrar atividades ocultas"}
                            >
                                <span className="material-icons" style={{ fontSize: '18px' }}>{showHiddenActivities ? 'visibility' : 'visibility_off'}</span>
                                {showHiddenActivities ? "Esconder Ocultos" : "Mostrar Ocultos"}
                            </button>
                        </div>
                      </div>
                      <table className="schedule-table" style={{ width: scheduleTableColumnWidths.reduce((a, b) => a + b, 0) }}>
                          <ScheduleHeader 
                              dates={dates} 
                              dynamicColumns={activeProject.dynamicColumns}
                              columnWidths={scheduleTableColumnWidths} 
                              onResizeStart={handleResizeStart} 
                              stickyColumnPositions={stickyColumnPositions} 
                              onOpenFilter={handleOpenFilter} 
                              activeFilters={activeFilters} 
                              visibleColumns={visibleColumns}
                              onColumnNameUpdate={handleColumnNameUpdate}
                              onAddColumn={handleAddColumn}
                              onRemoveColumn={handleRemoveColumn}
                              onMoveColumn={handleMoveColumn}
                          />
                          <ScheduleBody
                              renderableRows={renderableRows}
                              dates={dates}
                              dynamicColumns={activeProject.dynamicColumns}
                              columnWidths={scheduleTableColumnWidths}
                              stickyColumnPositions={stickyColumnPositions}
                              selectedItems={selectedItems}
                              onRowClick={handleRowClick}
                              activeCell={activeCell}
                              onCellMouseDown={handleCellMouseDown}
                              onCellMouseEnter={handleCellMouseEnter}
                              onCellRightClick={handleCellRightClick}
                              selectionBlock={selectionBlock}
                              cutSelectionBlock={cutSelectionBlock}
                              isMovingBlock={isMovingBlock}
                              ghostBlockCells={ghostBlockCells}
                              onTextUpdate={handleTextUpdate}
                              onAddItem={handleAddItem}
                              onDeleteItem={(id, type) => {
                                  handleConfirmDeletion([{ id, type }]);
                              }}
                              onMoveItem={handleMoveItem}
                              draggedGroupInfo={draggedGroupInfo}
                              draggedActivityInfo={draggedActivityInfo}
                              onGroupDragStart={handleGroupDragStart}
                              onGroupDrop={handleGroupDrop}
                              onActivityDragStart={handleActivityDragStart}
                              onActivityDrop={handleActivityDrop}
                              onDragEnd={handleDragEnd}
                              onDropTargetChange={setDropTargetId}
                              dropTargetId={dropTargetId}
                              visibleColumns={visibleColumns}
                              onToggleHideActivity={handleToggleHideActivity}
                          />
                      </table>
                    </div>
                  )}
                  {currentPage === 'dailySummary' && <DailySummaryView data={summaryData} dates={dates} onTextUpdate={handleSummaryTextUpdate} onAddItem={handleSummaryAddItem} onDeleteItem={(id, type) => handleSummaryDeleteItem(id, type)} onSyncWithSchedule={() => dispatchSummary({ type: 'LOAD_DATA', payload: liveData })} />}
                  {currentPage === 'dashboard' && <DashboardView data={liveData} title={title} programmerName={activeProject.programmerName} dynamicColumns={activeProject.dynamicColumns}/>}
                  {currentPage === 'comparison' && <ComparisonView savedPlan={savedPlan} liveData={liveData} dates={dates} columnWidths={comparisonTableColumnWidths} onResizeStart={handleResizeStart} stickyColumnPositions={stickyColumnPositions} title={title} dynamicColumns={activeProject.dynamicColumns}/>}
                  {currentPage === 'manpower' && <ManpowerAllocationView project={activeProject} setProject={setActiveProject} dates={dates} title={title} zoomLevel={zoomLevels.manpower} />}
                  {currentPage === 'dailyAllocation' && <DailyAllocationView project={activeProject} setProject={setActiveProject} dates={dates} filteredData={filteredData} title={title} dateColumnWidth={effectiveDateColumnWidth} zoomLevel={zoomLevels.dailyAllocation} />}
                  {currentPage === 'manpowerDashboard' && <ManpowerDashboardView project={activeProject} dates={dates} title={title} programmerName={activeProject.programmerName}/>}
                  {currentPage === 'machines' && <MachineListView project={activeProject} setProject={setActiveProject} ai={ai} addToast={addToast} zoomLevel={zoomLevels.machines} />}
                  {currentPage === 'dailyMachineAllocation' && <DailyMachineAllocationView project={activeProject} setProject={setActiveProject} dates={dates} filteredData={filteredData} title={title} dateColumnWidth={effectiveDateColumnWidth} allMachineAllocationsGlobal={allMachineAllocationsGlobal} zoomLevel={zoomLevels.dailyMachineAllocation} />}
                  </>
              )}
            </main>
        </div>
      </div>
      )}
      <footer className="app-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px' }}>
          <span>Plataforma de Programação Avançada-V6</span>
          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>Criado por: <strong>Waldenir Oliveira</strong></span>
      </footer>
      <TutorialModal isOpen={isTutorialModalOpen} onClose={() => setTutorialModalOpen(false)} />
    </div>
  );
};