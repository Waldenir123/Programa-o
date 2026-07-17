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
    Project, UserProjects, Page, SelectedItem, ScheduleData, ToastMessage, RenderableRow, Status, Atividade, TarefaPrincipal,
    PREDEFINED_MANPOWER_ROLES, STATUS_LABELS, STATUS_COLOR_MAP, DynamicColumn, Machine, MachineStatus 
} from './state/types';

// Hooks
import { useScheduleInteraction } from './hooks/useScheduleInteraction';

// Utils
import { formatDate, getWeek, generateId, deepClone, flattenData, safeJsonParse, migrateProject, shiftScheduleKeys } from './utils/dataUtils';
import { parseTabularData, parseTxtToRows } from './utils/parsers';
import { exportToExcelAgent, exportToPdfAgent } from './utils/exportAgents';
import { APP_VERSION } from './version';
import * as XLSX from 'xlsx';

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
import { RichTextToolbar } from './components/RichTextToolbar';

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

const createDemoProject = (userId: string): Project => {
  const projId = 'demo-project-id';
  const demoData: ScheduleData = [
    {
      id: 'g-1',
      customValues: {
        'fa': 'Fase 1 - Fundações'
      },
      tarefas: [
        {
          id: 't-1',
          title: 'Escavações de valas',
          activities: [
            {
              id: 'a-1',
              name: 'Escavação mecânica com retro',
              sector: 'Setor A',
              schedule: {
                '2026-04-13': Status.Realizado,
                '2026-04-14': Status.Realizado,
                '2026-04-15': Status.Programado,
                '2026-04-16': Status.Programado,
              }
            }
          ]
        },
        {
          id: 't-2',
          title: 'Montagem de formas',
          activities: [
            {
              id: 'a-2',
              name: 'Carpintaria de fôrmas',
              sector: 'Setor A',
              schedule: {
                '2026-04-15': Status.Programado,
                '2026-04-16': Status.Programado,
                '2026-04-17': Status.NaoRealizado,
              }
            }
          ]
        }
      ]
    }
  ];

  return {
    id: projId,
    name: 'Projeto de Teste (PCP)',
    ownerId: userId,
    obra: 'Demonstração PCP',
    lastModified: Date.now(),
    title: 'Programação de Teste Semanal',
    startDate: '2026-04-13',
    programmerName: 'Waldenir Oliveira',
    liveData: demoData,
    savedPlan: deepClone(demoData),
    manpowerAllocation: {
      roles: [...PREDEFINED_MANPOWER_ROLES],
      hasSecondShift: false,
      data: {
          adm: {
            'Linha de Frente': { '2026-16': 10, '2026-17': 12 },
            'Encarregado': { '2026-16': 1, '2026-17': 1 }
          },
          shift2: {}
      }
    },
    dailyManpowerAllocation: {},
    machines: [
      { id: 'm-1', name: 'Escavadeira CAT 320', category: 'Escavação', status: MachineStatus.Funcionamento },
      { id: 'm-2', name: 'Mini Escavadeira Bobcat', category: 'Escavação', status: MachineStatus.Funcionamento }
    ],
    dailyMachineAllocation: {
      'a-1': {
        '2026-04-13': ['m-1'],
        '2026-04-14': ['m-2']
      }
    },
    dynamicColumns: [
      { id: 'fa', name: 'Fase/Agrupador', width: 120 }
    ],
    displaySettings: {
      visibleColumns: {
        'ID': true,
        'Fase/Agrupador': true,
        'TAREFA PRINCIPAL': true,
        'ATIVIDADE': true,
        'SETOR': true,
      }
    }
  };
};

const getProjectFixedColumnWidths = (project: Project): number[] => {
    const dynamicCols = project?.dynamicColumns || [];
    const beforeCols = dynamicCols.filter(c => c.position !== 'after');
    const afterCols = dynamicCols.filter(c => c.position === 'after');
    const expectedLength = dynamicCols.length + 4; // ID (1) + beforeCols + TAREFA PRINCIPAL (1) + afterCols + ATIVIDADE (1) + SETOR (1)
    
    if (project?.displaySettings?.fixedColumnWidths && project.displaySettings.fixedColumnWidths.length === expectedLength) {
        return project.displaySettings.fixedColumnWidths;
    }
    
    const widths = [50]; // ID
    beforeCols.forEach(c => widths.push(c.width || 130));
    widths.push(280); // TAREFA PRINCIPAL
    afterCols.forEach(c => widths.push(c.width || 130));
    widths.push(250); // ATIVIDADE
    widths.push(110); // SETOR
    return widths;
};

const getProjectComparisonFixedColumnWidths = (project: Project): number[] => {
    const dynamicCols = project?.dynamicColumns || [];
    const beforeCols = dynamicCols.filter(c => c.position !== 'after');
    const afterCols = dynamicCols.filter(c => c.position === 'after');
    const expectedLength = dynamicCols.length + 5; // ID (1) + beforeCols + TAREFA PRINCIPAL (1) + afterCols + ATIVIDADE (1) + SETOR (1) + PLANO (1)
    
    if (project?.displaySettings?.comparisonFixedColumnWidths && project.displaySettings.comparisonFixedColumnWidths.length === expectedLength) {
        return project.displaySettings.comparisonFixedColumnWidths;
    }
    
    const widths = [50]; // ID
    beforeCols.forEach(c => widths.push(c.width || 130));
    widths.push(280); // TAREFA PRINCIPAL
    afterCols.forEach(c => widths.push(c.width || 130));
    widths.push(250); // ATIVIDADE
    widths.push(110); // SETOR
    widths.push(80);  // PLANO
    return widths;
};

export const App = () => {
  // --- STATE MANAGEMENT ---
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [currentUser, setCurrentUser] = useState<User | null>({
    uid: 'public-user',
    email: 'public@example.com',
    displayName: 'Planejador Geral',
    emailVerified: true,
    isAnonymous: true,
  } as any);
  const [isAuthReady, setIsAuthReady] = useState(true);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [lastSavedTime, setLastSavedTime] = useState<number | null>(null);
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(false);

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
  const [activitySearchText, setActivitySearchText] = useState('');
  
  const [isImportModalOpen, setImportModalOpen] = useState(false);

  const handleToggleHideItem = useCallback((id: string, type: 'group' | 'task' | 'activity') => {
      dispatch({ type: 'TOGGLE_HIDE_ITEM', payload: { id, type } });
  }, []);
  const [isLoadModalOpen, setLoadModalOpen] = useState(false);
  const [isSaveModalOpen, setisSaveModalOpen] = useState(false);
  const [isDeletionModalOpen, setDeletionModalOpen] = useState(false);
  const [isPrintModalOpen, setPrintModalOpen] = useState(false);
  const [isTutorialModalOpen, setTutorialModalOpen] = useState(false);
  const [annotationPopup, setAnnotationPopup] = useState<{ activityId: string, date: string, rect: DOMRect, isEditing: boolean, text: string } | null>(null);

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
  const [draggedTaskInfo, setDraggedTaskInfo] = useState<{ task: TarefaPrincipal, groupId: string } | null>(null);
  const [draggedActivityInfo, setDraggedActivityInfo] = useState<{ activity: Atividade, taskId: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Column resizing and zoom state
  const [fixedColumnWidths, setFixedColumnWidths] = useState<number[]>([50, 130, 280, 250, 110]);
  const [comparisonFixedColumnWidths, setComparisonFixedColumnWidths] = useState<number[]>([50, 130, 280, 250, 110, 80]);
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
      'SETOR': true,
  });
  
  const gridRef = useRef<HTMLDivElement>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(0);

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
      setToasts(currentToasts => [
          ...currentToasts,
          { id: nextToastId.current++, message, type }
      ]);
  }, []);
  
  const quickImportInputRef = useRef<HTMLInputElement>(null);
  const handleExportTxt = () => {
    if (!activeProject) return;
    const projectData = {
        name: activeProject.name,
        obra: activeProject.obra,
        data: liveData, // Actual detailed live schedule data!
        summaryData: summaryData, // Daily summary data!
        startDate: activeProject.startDate,
    };
    const jsonString = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonString], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cronograma_${activeProject.name}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportTxtClick = () => {
      txtImportInputRef.current?.click();
  };

  const excelImportInputRef = useRef<HTMLInputElement>(null);
  const txtImportInputRef = useRef<HTMLInputElement>(null);

  // --- DERIVED STATE FROM activeProject ---
  const savedPlan = useMemo(() => activeProject?.savedPlan || null, [activeProject]);
  const title = useMemo(() => activeProject?.title || '', [activeProject]);

  useEffect(() => {
    if (activeProject) {
      setFixedColumnWidths(getProjectFixedColumnWidths(activeProject));
      setComparisonFixedColumnWidths(getProjectComparisonFixedColumnWidths(activeProject));
    }
  }, [activeProject?.id]);
  const [currentStartDate, setCurrentStartDate] = useState(() => activeProject?.startDate ? new Date(activeProject.startDate + 'T00:00:00Z') : new Date('2026-04-13T00:00:00Z'));
  const [goToWeekInput, setGoToWeekInput] = useState(() => getWeek(currentStartDate));
  const printNumWeeks = useMemo(() => {
    const currentZoom = zoomLevels[currentPage] || 100;
    let numWeeks = 4; // Default 4 weeks at 100% zoom
    if (currentZoom <= 85) numWeeks = 6;
    if (currentZoom <= 65) numWeeks = 8;
    if (currentZoom <= 45) numWeeks = 12;
    if (currentZoom <= 30) numWeeks = 16;
    return numWeeks;
  }, [zoomLevels, currentPage]);

  const dates = useMemo(() => {
    return Array.from({length: 26 * 7}, (_, i) => { // 26 Weeks for view
        const d = new Date(currentStartDate);
        d.setUTCDate(currentStartDate.getUTCDate() + i);
        return d;
    });
  }, [currentStartDate]);
  
  const filteredData = useMemo(() => {
    const filters = activeFilters as Record<string, Set<string>>;
    const hasActiveFilters = Object.values(filters).some(s => s && s.size > 0);

    if (!liveData) {
        return [];
    }

    // Apply showHiddenActivities and hasActiveFilters
    let groupsFiltered = (liveData || [])
        .filter(group => showHiddenActivities || !group.isHidden)
        .map(group => {
            const filteredTarefas = (group.tarefas || [])
                .filter(task => showHiddenActivities || !task.isHidden)
                .map(task => {
                    const actSelections = filters['atividade'];
                    const isAtividadeFilterActive = actSelections && actSelections.size > 0;
                    const sectorSelections = filters['sector'];
                    const isSectorFilterActive = sectorSelections && sectorSelections.size > 0;
                    const searchLower = activitySearchText.toLowerCase();
                    
                    const filteredActivities = (task.activities || []).filter(act => {
                        if (searchLower && act.name && !act.name.toLowerCase().includes(searchLower)) {
                            return false;
                        }
                        
                        if (isAtividadeFilterActive && !actSelections.has(act.name)) {
                            return false;
                        }

                        if (isSectorFilterActive && !sectorSelections.has(act.sector || '')) {
                            return false;
                        }
                        
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
                    if (colId === 'tarefaPrincipal' || colId === 'atividade' || colId === 'sector') continue;
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

    let finalGroups = groupsFiltered.map(group => {
        const _tarefas = (group.tarefas || []).filter(task => {
            const originalTask = (liveData || []).find(g => g.id === group.id)?.tarefas?.find(t => t.id === task.id);
            if (originalTask && (originalTask.activities || []).length > 0 && (task.activities || []).length === 0) {
                return false; // Hide task if all its activities were filtered out
            }
            return true;
        });
        return { ...group, tarefas: _tarefas };
    }).filter(group => {
        const originalGroup = (liveData || []).find(g => g.id === group.id);
        if (originalGroup && (originalGroup.tarefas || []).length > 0 && (group.tarefas || []).length === 0) {
            return false; // Hide group if all its tasks were filtered out
        }
        return true;
    });
    
    return finalGroups;
  }, [liveData, activeFilters, showHiddenActivities, activitySearchText]);

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
  const activeProjectRef = useRef(activeProject);
  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    // Para contornar bloqueios de iframe/cookies de terceiros no navegador,
    // configuramos por padrão o perfil 'public-user' para acessar o Firestore diretamente sem barreiras de login.
    setCurrentUser({
      uid: 'public-user',
      email: 'public@example.com',
      displayName: 'Planejador Geral',
      emailVerified: true,
      isAnonymous: true,
    } as any);
    setIsAuthReady(true);
  }, []);

  useEffect(() => {
    if (!isAuthReady || !currentUser) {
       setProjects({});
       return;
    }

    if (currentUser.uid === 'guest-user') {
       if (activeProjectRef.current) return;
       let localProjects: Record<string, Project> = {};
       const localProjectsRaw = localStorage.getItem('pcp-local-projects');
       if (localProjectsRaw) {
           try {
               const parsed = JSON.parse(localProjectsRaw);
               Object.keys(parsed).forEach(id => {
                   localProjects[id] = migrateProject(parsed[id]);
               });
           } catch (e) {
               console.error("Local projects parse error:", e);
           }
       }
       
       if (Object.keys(localProjects).length === 0) {
           const demo = migrateProject(createDemoProject('guest-user'));
           localProjects[demo.id] = demo;
           localStorage.setItem('pcp-local-projects', JSON.stringify(localProjects));
       }
       
       setProjects(localProjects);
       
       const lastActiveId = localStorage.getItem(`pcp-lastActive-guest-user`);
       const projectToLoad = migrateProject(localProjects[lastActiveId!] || Object.values(localProjects)[0]);
       if (projectToLoad) {
           setLastSavedTime(projectToLoad.lastModified);
           setActiveProject(projectToLoad);
           dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
           dispatchSummary({ type: 'LOAD_DATA', payload: projectToLoad.summaryData || projectToLoad.liveData });
       }
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

           newProjects[docSnap.id] = migrateProject({ id: docSnap.id, ...data });
        });
        setProjects((prev) => {
           if (Object.keys(prev).length === 0 && Object.keys(newProjects).length > 0) needsInitialLoad = true;
           return newProjects;
        });
        
        if (needsInitialLoad && !activeProjectRef.current) {
            const lastActiveId = localStorage.getItem(`pcp-lastActive-${currentUser.uid}`);
            const projectToLoad = newProjects[lastActiveId!];
            if (projectToLoad) {
                setLastSavedTime(projectToLoad.lastModified);
                setActiveProject(projectToLoad);
            if (projectToLoad.startDate) {
                setCurrentStartDate(new Date(projectToLoad.startDate + 'T00:00:00Z'));
            }
                dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
            } else if (Object.keys(newProjects).length > 0) {
                 setLoadModalOpen(true);
            }
        }
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'projects');
    });
    return unsubscribe;
  }, [currentUser, isAuthReady]);

  const handleGuestLogin = () => {
    const guestUser = {
      uid: 'guest-user',
      email: 'guest@example.com',
      displayName: 'Usuário de Teste (Convidado)',
      emailVerified: true,
      isAnonymous: true,
    } as any;
    localStorage.setItem('pcp-auth-pref', 'guest');
    setCurrentUser(guestUser);
    setIsAuthReady(true);
  };

  const handleLogout = async () => {
    if (activeProject) {
      await persistProjectToFirebase(activeProject);
    }
    setActiveProject(null);
    addToast('Projeto salvo e fechado com sucesso!', 'success');
  };

  const persistProjectToFirebase = async (project: Project) => {
    if (currentUser?.uid === 'guest-user') {
      try {
        const localProjectsRaw = localStorage.getItem('pcp-local-projects');
        const localProjects = localProjectsRaw ? JSON.parse(localProjectsRaw) : {};
        localProjects[project.id] = project;
        localStorage.setItem('pcp-local-projects', JSON.stringify(localProjects));
        setLastSavedTime(Date.now());
        setProjects(localProjects);
      } catch (e) {
        console.error("Local save error:", e);
      }
      return;
    }
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
      setLastSavedTime(Date.now());
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
  
  const handleSaveProject = useCallback(async (silent: boolean | React.MouseEvent = false) => {
    if (!currentUser || !activeProject) return;
    
    // Convert Set filters to array for serialization
    const serializableFilters: Record<string, string[]> = {};
    Object.entries(activeFilters).forEach(([key, set]) => {
      serializableFilters[key] = Array.from((set as any) || []);
    });

    const projectToSave = { 
        ...activeProject, 
        liveData, 
        summaryData,
        lastModified: Date.now(),
        displaySettings: {
            ...activeProject.displaySettings,
            visibleColumns,
            activeFilters: serializableFilters as any,
            fixedColumnWidths,
            comparisonFixedColumnWidths
        }
    };
    setActiveProject(projectToSave); 
    await persistProjectToFirebase(projectToSave);
    if (silent !== true) {
      addToast(`Projeto '${projectToSave.name}' salvo!`, 'success');
    }
  }, [currentUser, activeProject, liveData, summaryData, addToast, visibleColumns, activeFilters, fixedColumnWidths, comparisonFixedColumnWidths]);

  const handleSaveAndExit = useCallback(async () => {
    if (!activeProject) return;
    await handleSaveProject(true);
    addToast(`Projeto '${activeProject.name}' salvo com sucesso!`, 'success');
    setActiveProject(null);
  }, [activeProject, handleSaveProject, addToast]);

  useEffect(() => {
    if (!isAutoSaveEnabled) return;
    const intervalId = setInterval(() => {
      if (activeProject) {
        handleSaveProject(true);
        addToast('Salvamento automático concluído', 'success');
      }
    }, 120000); // 2 minutes
    return () => clearInterval(intervalId);
  }, [handleSaveProject, activeProject, isAutoSaveEnabled, addToast]);

  const handleLoadProject = useCallback((projectId: string) => {
    if (!currentUser) return;
    const rawProject = projects[projectId];
    if (rawProject) {
        const projectToLoad = migrateProject(rawProject);
        setLastSavedTime(projectToLoad.lastModified);
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
    if (currentUser.uid === 'guest-user') {
      try {
        const localProjectsRaw = localStorage.getItem('pcp-local-projects');
        const localProjects = localProjectsRaw ? JSON.parse(localProjectsRaw) : {};
        delete localProjects[projectId];
        localStorage.setItem('pcp-local-projects', JSON.stringify(localProjects));
        setProjects(localProjects);
        addToast(`Projeto '${deletedProjectName}' excluído.`, 'success');
        if (activeProject?.id === projectId) {
            const nextProject = Object.values(localProjects as Record<string, Project>).sort((a,b) => b.lastModified - a.lastModified)[0];
            if (nextProject) {
                handleLoadProject(nextProject.id);
            } else {
                 setActiveProject(null);
                 localStorage.removeItem('pcp-lastActive-guest-user');
            }
        }
      } catch (e) {
         console.error(e);
      }
      return;
    }
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
  
  const handleMoveProject = async (id: string, newObra: string) => {
    if (!currentUser) return;
    if (currentUser.uid === 'guest-user') {
      try {
        const localProjectsRaw = localStorage.getItem('pcp-local-projects');
        const localProjects = localProjectsRaw ? JSON.parse(localProjectsRaw) : {};
        if (localProjects[id]) {
          localProjects[id].obra = newObra;
          localProjects[id].lastModified = Date.now();
          localStorage.setItem('pcp-local-projects', JSON.stringify(localProjects));
          setProjects(localProjects);
          if (activeProject && activeProject.id === id) {
              setActiveProject(prev => prev ? { ...prev, obra: newObra } : prev);
          }
          addToast(`Projeto movido para pasta '${newObra}'`, 'success');
        }
      } catch (e) {
        console.error(e);
      }
      return;
    }
    try {
      await setDoc(doc(db, 'projects', id), { obra: newObra, lastModified: Date.now() }, { merge: true });
      addToast(`Projeto movido para pasta '${newObra}'`, 'success');
      if (activeProject && activeProject.id === id) {
          setActiveProject(prev => prev ? { ...prev, obra: newObra } : prev);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projects/' + id);
    }
  };

  const handleRenameProject = async (id: string, newName: string) => {
    if (!currentUser) return;
    if (currentUser.uid === 'guest-user') {
      try {
        const localProjectsRaw = localStorage.getItem('pcp-local-projects');
        const localProjects = localProjectsRaw ? JSON.parse(localProjectsRaw) : {};
        if (localProjects[id]) {
          localProjects[id].name = newName;
          localProjects[id].lastModified = Date.now();
          localStorage.setItem('pcp-local-projects', JSON.stringify(localProjects));
          setProjects(localProjects);
          addToast(`Projeto renomeado para '${newName}'`, 'success');
          if (activeProject && activeProject.id === id) {
              setActiveProject(prev => prev ? { ...prev, name: newName } : prev);
          }
        }
      } catch (e) {
        console.error(e);
      }
      return;
    }
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

    if (currentUser.uid === 'guest-user') {
      try {
        const localProjectsRaw = localStorage.getItem('pcp-local-projects');
        const localProjects = localProjectsRaw ? JSON.parse(localProjectsRaw) : {};
        projectsInFolder.forEach(project => {
          if (localProjects[project.id]) {
            localProjects[project.id].obra = newName;
            localProjects[project.id].lastModified = Date.now();
          }
        });
        localStorage.setItem('pcp-local-projects', JSON.stringify(localProjects));
        setProjects(localProjects);
        addToast(`Pasta '${oldName}' renomeada para '${newName}'`, 'success');
        if (activeProject && (activeProject.obra || 'Geral') === oldName) {
            setActiveProject(prev => prev ? { ...prev, obra: newName } : prev);
        }
      } catch (e) {
         console.error(e);
      }
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

    if (currentUser.uid === 'guest-user') {
      try {
        const localProjectsRaw = localStorage.getItem('pcp-local-projects');
        const localProjects = localProjectsRaw ? JSON.parse(localProjectsRaw) : {};
        projectsInFolder.forEach(project => {
          delete localProjects[project.id];
        });
        localStorage.setItem('pcp-local-projects', JSON.stringify(localProjects));
        setProjects(localProjects);
        addToast(`Pasta '${folderName}' e seus ${projectsInFolder.length} arquivos foram excluídos.`, 'success');
        if (activeProject && (activeProject.obra || 'Geral') === folderName) {
            const nextProject = Object.values(localProjects as Record<string, Project>).sort((a,b) => b.lastModified - a.lastModified)[0];
            if (nextProject) {
                handleLoadProject(nextProject.id);
            } else {
                 setActiveProject(null);
                 localStorage.removeItem('pcp-lastActive-guest-user');
            }
        }
      } catch (e) {
         console.error(e);
      }
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

    let oldValue: string | undefined;
    let filterKey: string | undefined;

    if (liveData) {
        if (field === 'tarefa') {
            liveData.forEach(g => g.tarefas.forEach(t => { if (t.id === id) oldValue = t.title; }));
            filterKey = 'tarefaPrincipal';
        } else if (field === 'atividade') {
            liveData.forEach(g => g.tarefas.forEach(t => t.activities.forEach(a => { if (a.id === id) oldValue = a.name; })));
            filterKey = 'atividade';
        } else if (!['tarefa_fa', 'sector'].includes(field)) {
            liveData.forEach(g => { if (g.id === id) oldValue = g.customValues?.[field]; });
            filterKey = field;
        }
    }

    if (oldValue !== undefined && filterKey && oldValue !== value) {
        const currentOldValue = oldValue; // capture for closure
        setActiveFilters(prev => {
            if (!prev[filterKey!]) return prev;
            if (prev[filterKey!].has(currentOldValue)) {
                const newFilters = { ...prev };
                const updatedSet = new Set(newFilters[filterKey!]);
                updatedSet.delete(currentOldValue);
                updatedSet.add(value);
                newFilters[filterKey!] = updatedSet;
                return newFilters;
            }
            return prev;
        });
    }
    
    dispatch({ type: 'UPDATE_TEXT', payload: { id, field: field as any, value } });
  }, [activeProject, liveData]);

  const handleSummaryTextUpdate = useCallback((id: string, field: string, value: string) => {
    dispatchSummary({ type: 'UPDATE_TEXT', payload: { id, field: field as any, value } });
  }, []);

  const handleSummaryAddItem = useCallback((type: 'group' | 'task' | 'activity', parentId?: string, date?: string) => {
    dispatchSummary({ type: 'ADD_ITEM', payload: { type, parentId, date, status: Status.Programado } });
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

  const handleAddItem = useCallback((type: 'group' | 'task' | 'activity', parentId?: string, insertAfterId?: string) => {
      dispatch({ type: 'ADD_ITEM', payload: { type, parentId, insertAfterId } });
  }, []);

  const handleDuplicateTask = useCallback((taskId: string) => {
      dispatch({ type: 'DUPLICATE_TASK', payload: { taskId } });
  }, []);

  const handleMoveItem = useCallback((id: string, type: 'task' | 'activity', direction: 'up' | 'down') => {
      dispatch({ type: 'MOVE_ITEM', payload: { id, type, direction } });
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
        let finalContent = text;
        
        if (file) {
            const isExcel = file.name.match(/\.(xlsx|xls|csv)$/i);
            if (isExcel) {
                const data = await file.arrayBuffer();
                const workbook = XLSX.read(data, { cellDates: true });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const csvData = XLSX.utils.sheet_to_csv(worksheet);
                finalContent = (finalContent ? finalContent + "\n\n" : "") + csvData;
            } else {
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
        }
        const importedData = await parseScheduleWithAI(ai, finalContent, fileData);
        dispatch({ type: 'SET_DATA', payload: importedData });
        if (activeProject) {
            const updatedProject: Project = {
                ...activeProject,
                liveData: importedData,
                lastModified: Date.now()
            };
            setActiveProject(updatedProject);
            await persistProjectToFirebase(updatedProject);
        }
        setImportModalOpen(false);
        addToast("Cronograma importado com sucesso!", "success");
    } catch (error) {
        addToast(`Falha ao importar: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [ai, addToast, dispatch, activeProject, persistProjectToFirebase]);

  const handleQuickImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ai) {
      addToast("A chave de API para o Gemini não está configurada.", "error");
      return;
    }
    
    addToast(`Processando o arquivo '${file.name}' com a IA...`, 'success');

    try {
        let fileData: { mimeType: string, data: string } | null = null;
        let finalContent = '';

        const isExcel = file.name.match(/\.(xlsx|xls|csv)$/i);
        if (isExcel) {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { cellDates: true });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            finalContent = XLSX.utils.sheet_to_csv(worksheet);
        } else {
            fileData = await new Promise<{ mimeType: string, data: string }>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const result = e.target?.result as string;
                    if (!result) return reject(new Error("Não foi possível ler o arquivo."));
                    resolve({ mimeType: file.type, data: result.split(',')[1] });
                };
                reader.onerror = (error) => reject(error);
                reader.readAsDataURL(file);
            });
        }

        const importedData = await parseScheduleWithAI(ai, finalContent, fileData); // Pass empty text if no finalContent
        dispatch({ type: 'SET_DATA', payload: importedData });
        if (activeProject) {
            const updatedProject: Project = {
                ...activeProject,
                liveData: importedData,
                lastModified: Date.now()
            };
            setActiveProject(updatedProject);
            await persistProjectToFirebase(updatedProject);
        }
        addToast("Cronograma importado com sucesso!", "success");
    } catch (error) {
        addToast(`Falha ao importar: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
        if (event.target) {
            event.target.value = '';
        }
    }
  }, [ai, addToast, dispatch, activeProject, persistProjectToFirebase]);

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
        const workbook = XLSX.read(data, { cellDates: true });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const projectStartDateStr = activeProject?.startDate || '2026-06-15';
        const importedData = parseTabularData(jsonData, projectStartDateStr); 
        
        // Extract earliest date to shift calendar view automatically
        let minDateStr = '';
        importedData.forEach(group => {
            group.tarefas.forEach(task => {
                task.activities.forEach(activity => {
                    if (activity.schedule) {
                        Object.keys(activity.schedule).forEach(dateKey => {
                            if (!minDateStr || dateKey < minDateStr) {
                                minDateStr = dateKey;
                            }
                        });
                    }
                });
            });
        });

        dispatch({ type: 'SET_DATA', payload: importedData });
        if (activeProject) {
            const updatedProject: Project = {
                ...activeProject,
                liveData: importedData,
                ...(minDateStr ? { startDate: minDateStr } : {}),
                lastModified: Date.now()
            };
            setActiveProject(updatedProject);
            if (minDateStr) {
                setCurrentStartDate(new Date(minDateStr + 'T00:00:00Z'));
            }
            await persistProjectToFirebase(updatedProject);
        }
        addToast("Cronograma importado do Excel com sucesso!", "success");
    } catch (error) {
        addToast(`Falha ao importar do Excel: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
        if (event.target) event.target.value = '';
    }
  }, [addToast, dispatch, activeProject, persistProjectToFirebase]);

  const handleImportTxtFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      
      try {
          // Decode file content as ArrayBuffer with Windows-1252 fallback for legacy Portuguese files
          let text = '';
          const buffer = await file.arrayBuffer();
          const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
          try {
              text = utf8Decoder.decode(buffer);
          } catch (e) {
              const winDecoder = new TextDecoder('windows-1252');
              text = winDecoder.decode(buffer);
          }
          // Remove BOM and trim
          const cleanText = text.replace(/^\uFEFF/, '');
          const trimmedText = cleanText.trim();
          
          if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
              const parsed = JSON.parse(trimmedText);
              let importedData: any = null;
              let importedSummaryData: any = null;
              let startDateToSet: Date | null = null;
              
              if (parsed && Array.isArray(parsed.data)) {
                   importedData = parsed.data;
                   if (parsed.summaryData) {
                       importedSummaryData = parsed.summaryData;
                   }
                   if (parsed.startDate) {
                       startDateToSet = new Date(parsed.startDate + 'T00:00:00Z');
                   }
              } else if (parsed && Array.isArray(parsed.liveData)) {
                   // Handle fully structured backup object direct from state representation
                   importedData = parsed.liveData;
                   if (parsed.summaryData) {
                       importedSummaryData = parsed.summaryData;
                   }
                   if (parsed.startDate) {
                       startDateToSet = new Date(parsed.startDate + 'T00:00:00Z');
                   }
              } else if (Array.isArray(parsed)) {
                   importedData = parsed;
              }

              if (importedData) {
                   dispatch({ type: 'SET_DATA', payload: importedData });
                   if (importedSummaryData) {
                       dispatchSummary({ type: 'LOAD_DATA', payload: importedSummaryData });
                   } else {
                       dispatchSummary({ type: 'LOAD_DATA', payload: importedData });
                   }
                   
                   if (startDateToSet) {
                       setCurrentStartDate(startDateToSet);
                   }
                   
                   let projectToSet = activeProject;
                   if (!projectToSet && currentUser) {
                       const name = parsed.name || `Projeto Importado ${new Date().toLocaleDateString()}`;
                       const obra = parsed.obra || 'Geral';
                       projectToSet = createNewProject(name, obra);
                       projectToSet.ownerId = currentUser.uid;
                   }
                   
                   if (projectToSet) {
                       const updatedProject: Project = {
                           ...projectToSet,
                           name: parsed.name || projectToSet.name,
                           obra: parsed.obra || projectToSet.obra,
                           liveData: importedData,
                           summaryData: importedSummaryData || importedData,
                           ...(parsed.startDate ? { startDate: parsed.startDate } : {}),
                           lastModified: Date.now()
                       };
                       setActiveProject(updatedProject);
                       await persistProjectToFirebase(updatedProject);
                   }
                   addToast("Cronograma TXT / JSON (Backup) importado com sucesso!", "success");
              } else {
                   addToast("O arquivo de backup não possui um formato estruturado válido.", "error");
              }
          } else {
              if (activeProject && !window.confirm("Isto substituirá o cronograma atual. Deseja continuar?")) {
                   if (event.target) event.target.value = '';
                   return;
              }
              const rows = parseTxtToRows(cleanText);
              const projectStartDateStr = activeProject?.startDate || '2026-06-15';
              const importedData = parseTabularData(rows, projectStartDateStr);
              
              // Extract earliest date to shift calendar view automatically
              let minDateStr = '';
              importedData.forEach(group => {
                  group.tarefas.forEach(task => {
                      task.activities.forEach(activity => {
                          if (activity.schedule) {
                              Object.keys(activity.schedule).forEach(dateKey => {
                                  if (!minDateStr || dateKey < minDateStr) {
                                      minDateStr = dateKey;
                                  }
                              });
                          }
                      });
                  });
              });

              dispatch({ type: 'SET_DATA', payload: importedData });
              dispatchSummary({ type: 'LOAD_DATA', payload: importedData });
              
              let projectToSet = activeProject;
              if (!projectToSet && currentUser) {
                  const name = `Projeto Importado ${new Date().toLocaleDateString()}`;
                  const obra = 'Geral';
                  projectToSet = createNewProject(name, obra);
                  projectToSet.ownerId = currentUser.uid;
              }

              if (projectToSet) {
                  const updatedProject: Project = {
                      ...projectToSet,
                      liveData: importedData,
                      summaryData: importedData,
                      ...(minDateStr ? { startDate: minDateStr } : (projectStartDateStr ? { startDate: projectStartDateStr } : {})),
                      lastModified: Date.now()
                  };
                  setActiveProject(updatedProject);
                  if (minDateStr) {
                      setCurrentStartDate(new Date(minDateStr + 'T00:00:00Z'));
                  } else if (projectStartDateStr) {
                      setCurrentStartDate(new Date(projectStartDateStr + 'T00:00:00Z'));
                  }
                  await persistProjectToFirebase(updatedProject);
              }
              addToast("Cronograma importado do arquivo de texto (TXT) com sucesso!", "success");
          }
      } catch(e) {
          addToast(`Falha ao ler o arquivo TXT/JSON: ${e instanceof Error ? e.message : String(e)}`, "error");
      } finally {
          if (event.target) event.target.value = '';
      }
  }, [addToast, dispatch, dispatchSummary, activeProject, currentUser, createNewProject, persistProjectToFirebase]);

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
    const options: Record<string, string[]> = { tarefaPrincipal: [], atividade: [], sector: [] };
    if (!activeProject) return options;
    
    activeProject.dynamicColumns.forEach(col => {
        options[col.id] = [];
    });

    (liveData || []).forEach(group => {
        (activeProject.dynamicColumns || []).forEach(col => {
            const val = group.customValues?.[col.id];
            if (val && !options[col.id].includes(val)) {
                options[col.id].push(val);
            }
        });
        (group.tarefas || []).forEach(task => {
            if (task.title && !options.tarefaPrincipal.includes(task.title)) {
                options.tarefaPrincipal.push(task.title);
            }
            (task.activities || []).forEach(act => {
                if (act.name && !options.atividade.includes(act.name)) {
                    options.atividade.push(act.name);
                }
                const s = act.sector || '';
                if (s && !options.sector.includes(s)) {
                    options.sector.push(s);
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

    const oldDateStr = activeProject?.startDate || '2026-04-13';
    const oldDate = new Date(oldDateStr + 'T00:00:00Z');
    const diffTime = newDate.getTime() - oldDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    setCurrentStartDate(newDate);

    if (activeProject) {
        let updatedLiveData = liveData;
        let updatedSummaryData = summaryData;
        let updatedDailyManpower = activeProject.dailyManpowerAllocation || {};
        let updatedDailyMachine = activeProject.dailyMachineAllocation || {};

        if (diffDays !== 0) {
            // Shift liveData keys
            updatedLiveData = liveData.map(group => ({
                ...group,
                tarefas: group.tarefas.map(task => ({
                    ...task,
                    activities: task.activities.map(activity => ({
                        ...activity,
                        schedule: shiftScheduleKeys(activity.schedule || {}, diffDays),
                        annotations: shiftScheduleKeys(activity.annotations || {}, diffDays)
                    }))
                }))
            }));

            // Shift summaryData keys
            if (summaryData) {
                updatedSummaryData = summaryData.map(group => ({
                    ...group,
                    tarefas: group.tarefas.map(task => ({
                        ...task,
                        activities: task.activities.map(activity => ({
                            ...activity,
                            schedule: shiftScheduleKeys(activity.schedule || {}, diffDays),
                            annotations: shiftScheduleKeys(activity.annotations || {}, diffDays)
                        }))
                    }))
                }));
            }

            // Shift daily manpower allocations
            const newDailyManpower: Record<string, any> = {};
            Object.entries(updatedDailyManpower).forEach(([dateStr, val]) => {
                const d = new Date(dateStr + 'T00:00:00Z');
                if (!isNaN(d.getTime())) {
                    d.setUTCDate(d.getUTCDate() + diffDays);
                    newDailyManpower[d.toISOString().split('T')[0]] = val;
                } else {
                    newDailyManpower[dateStr] = val;
                }
            });
            updatedDailyManpower = newDailyManpower;

            // Shift daily machine allocations
            const newDailyMachine: Record<string, any> = {};
            Object.entries(updatedDailyMachine).forEach(([dateStr, val]) => {
                const d = new Date(dateStr + 'T00:00:00Z');
                if (!isNaN(d.getTime())) {
                    d.setUTCDate(d.getUTCDate() + diffDays);
                    newDailyMachine[d.toISOString().split('T')[0]] = val;
                } else {
                    newDailyMachine[dateStr] = val;
                }
            });
            updatedDailyMachine = newDailyMachine;

            dispatch({ type: 'LOAD_DATA', payload: updatedLiveData });
            dispatchSummary({ type: 'LOAD_DATA', payload: updatedSummaryData || updatedLiveData });

            addToast(`Datas reprogramadas e deslocadas em ${diffDays} dias!`, 'info');
        }

        setActiveProject(p => p ? {
            ...p,
            startDate: newDateStr,
            liveData: updatedLiveData,
            summaryData: updatedSummaryData,
            dailyManpowerAllocation: updatedDailyManpower,
            dailyMachineAllocation: updatedDailyMachine,
            lastModified: Date.now()
        } : null);
    }
  }, [activeProject, liveData, summaryData, addToast]);

  const handleExportExcel = () => {
    if (!activeProject) return;
    exportToExcelAgent(filteredData, dates, activeProject, activeProject.dynamicColumns, visibleColumns);
  };

  const handleCellDoubleClick = useCallback((activityId: string, dateStr: string) => {
    const activity = liveData.flatMap(g => g.tarefas.flatMap(t => t.activities)).find(a => a.id === activityId);
    if (!activity) return;
    let text = activity.annotations?.[dateStr] || '';
    const userName = currentUser?.name || 'Usuário';
    
    // Automatically prepare text with the user name if it's empty
    if (!text) {
        text = `${userName}:\n`;
    }
    
    // Find the cell in the DOM to position the popup
    const cellElement = document.querySelector(`td[data-cell-id="${activityId}-${dateStr}"]`);
    if (cellElement) {
        const rect = cellElement.getBoundingClientRect();
        setAnnotationPopup({ activityId, date: dateStr, rect, isEditing: true, text });
    }
  }, [liveData, currentUser]);

  const handleAnnotationClick = useCallback((event: React.MouseEvent, annotation: string, activityId: string, dateStr: string, rect: DOMRect) => {
      setAnnotationPopup({ activityId, date: dateStr, rect, isEditing: false, text: annotation });
  }, []);

  const handleWhatsAppClick = useCallback((e: React.MouseEvent, activityId: string) => {
      e.stopPropagation();
      let activityName = '';
      let taskTitle = '';
      let taskFA = '';

      for (const group of liveData) {
          for (const task of group.tarefas) {
              const act = task.activities.find(a => a.id === activityId);
              if (act) {
                  activityName = act.name;
                  taskTitle = task.title;
                  taskFA = task.fa || '';
                  break;
              }
          }
          if (activityName) break;
      }

      const cleanTitle = taskTitle.replace(/<[^>]*>?/gm, '');
      const cleanActivity = activityName.replace(/<[^>]*>?/gm, '');
      
      const message = `Olá, tudo bem? Poderia me informar, por favor, qual status dessa atividade:\n\n📌 Tarefa Principal: ${cleanTitle}${taskFA ? ` (Nº FA ${taskFA})` : ''}\n⚙️ Atividade: ${cleanActivity}\n\nFico no aguardo, obrigado!`;
      
      navigator.clipboard.writeText(message).then(() => {
          addToast("Mensagem do WhatsApp copiada!", "success");
      }).catch(() => {
          addToast("Erro ao copiar mensagem do WhatsApp.", "error");
      });
  }, [liveData, addToast]);
  
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
    return ['ID', ...beforeNames, 'TAREFA PRINCIPAL', ...afterNames, 'ATIVIDADE', 'SETOR'];
  }, [activeProject?.dynamicColumns]);

  const comparisonHeaders = useMemo(() => {
    const dynamicCols = activeProject?.dynamicColumns || [];
    const beforeNames = dynamicCols.filter(c => c.position !== 'after').map(col => col.name);
    const afterNames = dynamicCols.filter(c => c.position === 'after').map(col => col.name);
    return ['ID', ...beforeNames, 'TAREFA PRINCIPAL', ...afterNames, 'ATIVIDADE', 'SETOR', 'PLANO'];
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

  const handleTaskDragStart = useCallback((task: TarefaPrincipal, groupId: string) => {
    setDraggedTaskInfo({ task, groupId });
  }, []);

  const handleTaskDrop = useCallback((targetGroupId: string, targetTaskId: string | null) => {
    if (!draggedTaskInfo) {
      handleDragEnd();
      return;
    }
    if (draggedTaskInfo.task.id === targetTaskId) {
      handleDragEnd();
      return;
    }
    dispatch({ type: 'MOVE_TASK_DND', payload: { draggedId: draggedTaskInfo.task.id, targetGroupId, targetId: targetTaskId } });
    handleDragEnd();
  }, [draggedTaskInfo]);

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
      setDraggedTaskInfo(null);
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
        setActiveProject(prev => {
            if (!prev) return null;
            return {
                ...prev,
                displaySettings: {
                    ...prev.displaySettings,
                    fixedColumnWidths,
                    comparisonFixedColumnWidths
                }
            };
        });
    }, [fixedColumnWidths, comparisonFixedColumnWidths]);

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

  const handleIntelligentReschedule = useCallback(() => {
    if (!selectionBlock) {
        addToast("Selecione um bloco de células primeiro.", "error");
        return;
    }

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

        const affectedItems: { activityId: string, taskId: string, dateStr: string }[] = [];

        for (let r = minRow; r <= maxRow; r++) {
            const rowInfo = renderableRows[r];
            if (rowInfo && rowInfo.activity) {
                for (let c = minCol; c <= maxCol; c++) {
                    const dateStr = datesStr[c];
                    if (!dateStr) continue;
                    const status = rowInfo.activity.schedule[dateStr];
                    if (status === Status.NaoRealizado || status === Status.Cancelado) {
                        affectedItems.push({
                            activityId: rowInfo.activity.id,
                            taskId: rowInfo.task.id,
                            dateStr
                        });
                    }
                }
            }
        }

        const selectionMaxDate = datesStr[maxCol];

        if (affectedItems.length > 0) {
            dispatch({ type: 'INTELLIGENT_RESCHEDULE', payload: { affectedItems, selectionMaxDate } });
            addToast(`Reprogramação inteligente aplicada a ${affectedItems.length} atividades.`, 'success');
        } else {
            addToast("Nenhuma programação Não Realizada (N) ou Cancelada (C) na seleção.", "error");
        }
    }
  }, [selectionBlock, renderableRows, dates, dispatch, addToast]);

  const handleShiftHoliday = useCallback((holidayDateStr: string, skipWeekends: boolean) => {
    dispatch({ type: 'SHIFT_HOLIDAY', payload: { holidayDateStr, skipWeekends } });
    const formatted = holidayDateStr.split('-').reverse().join('/');
    addToast(`Programação e anotações a partir de ${formatted} deslocadas para o próximo dia útil!`, 'success');
  }, [dispatch, addToast]);

  if (!isAuthReady) {
    return <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh',fontSize:'1.2rem',color:'#64748b'}}>Carregando...</div>;
  }
  if (!currentUser) {
    return <AuthScreen onGuestLogin={handleGuestLogin} />;
  }

  return (
    <div className={`app-wrapper ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <ToastContainer toasts={toasts} setToasts={setToasts} />
      <input type="file" ref={quickImportInputRef} onChange={handleQuickImport} style={{ display: 'none' }} accept="image/*,application/pdf,.xlsx,.csv" />
      <input type="file" ref={excelImportInputRef} onChange={handleImportExcelFile} style={{ display: 'none' }} accept=".xlsx, .xls" />
      <input type="file" ref={txtImportInputRef} onChange={handleImportTxtFile} style={{ display: 'none' }} accept=".txt, .json, .csv, .tsv" />
      {isImportModalOpen && <ImportModal isOpen={isImportModalOpen} onClose={() => setImportModalOpen(false)} onImportSchedule={handleImportSchedule} onImportFA={handleImportFA} />}
      {isLoadModalOpen && (
          <LoadModal 
            schedules={Object.values(projects || {})} 
            onLoad={handleLoadProject} 
            onDelete={handleDeleteProject}
            onRenameProject={handleRenameProject}
            onMoveProject={handleMoveProject}
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
               <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '16px', fontWeight: 500 }}>Versão: {APP_VERSION}</div>
               <p style={{ color: '#64748b', marginBottom: '24px' }}>Crie um novo planejamento ou abra um projeto existente para começar.</p>
               <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button className="submit-button" onClick={() => setisSaveModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '1rem' }}>
                        <span className="material-icons">add_box</span> Novo Projeto
                    </button>
                    <button className="control-button" onClick={() => setLoadModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '1rem', backgroundColor: '#fbbf24', border: 'none', color: '#1e293b', fontWeight: 'bold' }}>
                        <span className="material-icons">folder_open</span> Abrir Projeto
                    </button>
                    <button className="control-button" onClick={handleImportTxtClick} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '1rem', backgroundColor: '#e2e8f0', border: '1px solid #cbd5e1', color: '#334155', fontWeight: 'bold' }}>
                        <span className="material-icons">data_object</span> Importar Backup TXT / JSON
                    </button>
               </div>
               <div style={{ marginTop: '48px', padding: '8px 16px', border: '1px solid #e2e8f0', borderRadius: '20px', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                   <span className="material-icons" style={{ color: '#64748b', fontSize: '18px' }}>account_circle</span>
                   <span style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 500 }}>
                       Acesso Livre ({currentUser?.displayName || 'Planejador Geral'})
                   </span>
               </div>
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
                <button 
                  className="nav-tab" 
                  style={{ 
                    backgroundColor: '#10b981', 
                    color: '#ffffff', 
                    fontWeight: 'bold', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px', 
                    marginRight: '8px',
                    border: 'none',
                    cursor: 'pointer'
                  }} 
                  onClick={handleSaveAndExit}
                >
                    <span className="material-icons" style={{ fontSize: '18px' }}>exit_to_app</span> Salvar e Sair
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
                <div className="user-info" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 10px', backgroundColor: '#f1f5f9', borderRadius: '20px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span className="material-icons" style={{ color: '#475569', fontSize: '18px' }}>account_circle</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }} title={currentUser?.displayName || currentUser?.email || 'Usuário'}>
                            {currentUser?.displayName || currentUser?.email || 'Usuário'}
                        </span>
                    </div>
                    <button 
                        onClick={handleLogout} 
                        style={{ 
                            background: 'none', 
                            border: 'none', 
                            padding: '2px 6px', 
                            cursor: 'pointer', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '3px', 
                            borderRadius: '10px', 
                            backgroundColor: '#fee2e2', 
                            color: '#ef4444', 
                            fontSize: '0.7rem', 
                            fontWeight: 'bold',
                            transition: 'all 0.2s',
                        }}
                        title="Sair do aplicativo"
                    >
                        <span className="material-icons" style={{ fontSize: '12px' }}>logout</span> Sair
                    </button>
                </div>
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
                handleExportTxt={handleExportTxt} onImportTxtClick={handleImportTxtClick}
                handleOpenTutorial={() => setTutorialModalOpen(true)}
                handleDateChange={handleDateChange} startDate={currentStartDate}
                goToWeekInput={goToWeekInput} setGoToWeekInput={setGoToWeekInput} handleGoToWeek={handleGoToWeek}
                selectedItems={selectedItems} handleDeleteSelectedItems={handleDeleteSelectedItems} handleClearAll={handleClearAll}
                handleQuickImportClick={() => quickImportInputRef.current?.click()}
                onImportExcelClick={() => excelImportInputRef.current?.click()}
                visibleColumns={visibleColumns}
                toggleColumnVisibility={(col) => setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }))}
                onCloseMobile={() => setIsMobileNavVisible(false)}
                handleIntelligentReschedule={handleIntelligentReschedule}
                hasSelection={!!selectionBlock}
                handleShiftHoliday={handleShiftHoliday}
                activeCell={activeCell}
                handleSaveAndExit={handleSaveAndExit}
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
                    <>
                      <div className="project-detail-header" style={{ display: 'flex', gap: '24px', padding: '16px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', marginBottom: '8px', zIndex: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Obra / Projeto</label>
                            <div contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'name', e.currentTarget.textContent || '')} style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b', borderBottom: '1px dashed #cbd5e1', paddingBottom: '2px' }}>{activeProject.name}</div>
                        </div>
                        <div style={{ width: '200px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Programador</label>
                            <div contentEditable suppressContentEditableWarning onBlur={e => handleTextUpdate('', 'programmerName', e.currentTarget.textContent || '')} style={{ fontWeight: '500', color: '#334155', borderBottom: '1px dashed #cbd5e1' }}>{activeProject.programmerName || 'Não definido'}</div>
                        </div>
                        <RichTextToolbar />
                        <div style={{ width: '200px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Buscar Atividade</label>
                            <input
                                type="text"
                                value={activitySearchText}
                                onChange={(e) => setActivitySearchText(e.target.value)}
                                placeholder="ex: corte, ensaio..."
                                style={{
                                    width: '100%',
                                    padding: '4px 8px',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '4px',
                                    fontSize: '0.875rem'
                                }}
                            />
                        </div>
                        <div style={{ width: '150px', textAlign: 'right' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Último Salvamento</label>
                            <div style={{ color: '#64748b' }}>{lastSavedTime ? new Date(lastSavedTime).toLocaleString('pt-BR') : 'Aguardando...'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                onClick={() => {
                                    const newState = !isAutoSaveEnabled;
                                    setIsAutoSaveEnabled(newState);
                                    addToast(newState ? 'Salvamento Automático Ativado' : 'Salvamento Automático Desativado', newState ? 'success' : 'error');
                                }}
                                className="control-button"
                                style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: isAutoSaveEnabled ? '#e0e7ff' : '#fee2e2', color: isAutoSaveEnabled ? '#4338ca' : '#b91c1c', border: '1px solid', borderColor: isAutoSaveEnabled ? '#818cf8' : '#fca5a5', height: 'fit-content' }}
                                title={isAutoSaveEnabled ? "Desativar salvamento automático" : "Ativar salvamento automático"}
                            >
                                <span className="material-icons" style={{ fontSize: '18px' }}>{isAutoSaveEnabled ? 'autorenew' : 'sync_disabled'}</span>
                                {isAutoSaveEnabled ? 'Auto-Save: ON' : 'Auto-Save: OFF'}
                            </button>
                            {(Object.values(activeFilters).some((s: any) => s && s.size > 0) || activitySearchText) && (
                                <button
                                    onClick={() => {
                                        setActiveFilters({});
                                        setActivitySearchText('');
                                    }}
                                    className="control-button"
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid', borderColor: '#fca5a5', height: 'fit-content' }}
                                    title="Limpar todos os filtros ativos e busca"
                                >
                                    <span className="material-icons" style={{ fontSize: '18px' }}>filter_alt_off</span>
                                    Limpar Filtros
                                </button>
                            )}
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
                      <div className="table-wrapper">
                        <table className="schedule-table" style={{ width: scheduleTableColumnWidths.reduce((a, b) => a + b, 0) }}>
                          <colgroup>
                            {scheduleTableColumnWidths.map((width, idx) => {
                              const isVisible = width > 0;
                              return (
                                <col 
                                  key={idx} 
                                  style={{ 
                                    width: isVisible ? `${width}px` : '0px',
                                    display: isVisible ? 'table-column' : 'none'
                                  }} 
                                />
                              );
                            })}
                          </colgroup>
                          <ScheduleHeader 
                              printNumWeeks={printNumWeeks}
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
                              printNumWeeks={printNumWeeks}
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
                              onCellDoubleClick={handleCellDoubleClick}
                              onAnnotationClick={handleAnnotationClick}
                              onWhatsAppClick={handleWhatsAppClick}
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
                              onDuplicateTask={handleDuplicateTask}
                              draggedGroupInfo={draggedGroupInfo}
                              draggedTaskInfo={draggedTaskInfo}
                              draggedActivityInfo={draggedActivityInfo}
                              onGroupDragStart={handleGroupDragStart}
                              onGroupDrop={handleGroupDrop}
                              onTaskDragStart={handleTaskDragStart}
                              onTaskDrop={handleTaskDrop}
                              onActivityDragStart={handleActivityDragStart}
                              onActivityDrop={handleActivityDrop}
                              onDragEnd={handleDragEnd}
                              onDropTargetChange={setDropTargetId}
                              dropTargetId={dropTargetId}
                              visibleColumns={visibleColumns}
                              onToggleHideItem={handleToggleHideItem}
                          />
                      </table>
                    </div>
                  </>
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
          <span>Plataforma de Programação Avançada-V6 <span style={{ fontSize: '0.8rem', opacity: 0.7, marginLeft: '8px' }}>{APP_VERSION}</span></span>
          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>Criado por: <strong>Waldenir Oliveira</strong></span>
      </footer>
      <TutorialModal isOpen={isTutorialModalOpen} onClose={() => setTutorialModalOpen(false)} />
      {annotationPopup && (
          <div 
            style={{
                position: 'fixed', // Fixed so it won't scroll with page/table if we calculate rect on fixed viewport
                top: annotationPopup.rect.bottom + 5,
                left: annotationPopup.rect.left,
                zIndex: 1000,
                backgroundColor: '#fef9c3', // light yellow
                border: '1px solid #eab308',
                padding: '8px',
                borderRadius: '4px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                minWidth: '200px'
            }}
          >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#854d0e' }}>Anotação</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                      {!annotationPopup.isEditing && (
                          <button onClick={() => setAnnotationPopup(p => ({ ...p!, isEditing: true }))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                              <span className="material-icons" style={{ fontSize: '14px', color: '#854d0e' }}>edit</span>
                          </button>
                      )}
                      <button onClick={() => setAnnotationPopup(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                          <span className="material-icons" style={{ fontSize: '14px', color: '#854d0e' }}>close</span>
                      </button>
                  </div>
              </div>
              {annotationPopup.isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <textarea
                          autoFocus
                          value={annotationPopup.text}
                          onChange={(e) => setAnnotationPopup(p => ({ ...p!, text: e.target.value }))}
                          style={{ width: '100%', minHeight: '60px', padding: '4px', fontSize: '12px', border: '1px solid #fde047', backgroundColor: '#fffbeb', borderRadius: '2px', resize: 'vertical' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                          <button onClick={() => {
                              dispatch({ type: 'UPDATE_ANNOTATION', payload: { activityId: annotationPopup.activityId, date: annotationPopup.date, text: null } });
                              setAnnotationPopup(null);
                          }} style={{ padding: '2px 8px', fontSize: '11px', border: '1px solid #ef4444', backgroundColor: '#fee2e2', color: '#ef4444', borderRadius: '2px', cursor: 'pointer' }}>Excluir</button>
                          <button onClick={() => {
                              dispatch({ type: 'UPDATE_ANNOTATION', payload: { activityId: annotationPopup.activityId, date: annotationPopup.date, text: annotationPopup.text } });
                              setAnnotationPopup(null);
                          }} style={{ padding: '2px 8px', fontSize: '11px', border: '1px solid #10b981', backgroundColor: '#d1fae5', color: '#10b981', borderRadius: '2px', cursor: 'pointer' }}>Salvar</button>
                      </div>
                  </div>
              ) : (
                  <div style={{ fontSize: '12px', color: '#3f6212', whiteSpace: 'pre-wrap' }}>
                      {annotationPopup.text}
                  </div>
              )}
          </div>
      )}
    </div>
  );
};