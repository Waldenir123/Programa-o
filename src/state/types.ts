// --- TYPES AND ENUMS ---
export enum Status {
  Programado = 'X',
  Realizado = 'Ok',
  Cancelado = 'C',
  NaoRealizado = 'N',
}
export const STATUS_LABELS: Record<Status, string> = {
  [Status.Programado]: 'Programado',
  [Status.Realizado]: 'Realizado',
  [Status.Cancelado]: 'Cancelado',
  [Status.NaoRealizado]: 'Não Realizado',
};
export const STATUS_CLASS_MAP: Record<Status, string> = {
    [Status.Programado]: 'programado',
    [Status.Realizado]: 'realizado',
    [Status.Cancelado]: 'cancelado',
    [Status.NaoRealizado]: 'nao-realizado',
};
export const STATUS_COLOR_MAP: Record<Status, string> = {
    [Status.Programado]: '#fef3c7',     // Amber-100
    [Status.Realizado]: '#d1fae5',      // Emerald-100
    [Status.Cancelado]: '#dfe6f0',      // Slate-Blue tint
    [Status.NaoRealizado]: '#ffe4e6',   // Rose-100
};
export const STATUS_COLOR_MAP_DARK: Record<Status, string> = {
    [Status.Programado]: '#b45309',     // Amber-700
    [Status.Realizado]: '#047857',      // Emerald-700
    [Status.Cancelado]: '#475569',      // Slate-600
    [Status.NaoRealizado]: '#be123c',   // Rose-700
};
export const STATUS_BADGE_CLASSES: Record<Status, string> = {
    [Status.Programado]: 'bg-amber-100 text-amber-800 border border-amber-200',
    [Status.Realizado]: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    [Status.Cancelado]: 'bg-slate-200/80 text-slate-700 border border-slate-300',
    [Status.NaoRealizado]: 'bg-rose-100 text-rose-800 border border-rose-200',
};
export const STATUS_CYCLE: Status[] = [Status.Programado, Status.Realizado, Status.Cancelado, Status.NaoRealizado];

export interface Atividade {
  id: string;
  name: string;
  schedule: Record<string, Status>;
  annotations?: Record<string, string>;
  sector?: string;
  isHidden?: boolean;
}
export interface TarefaPrincipal {
  id: string;
  title: string;
  fa?: string;
  activities: Atividade[];
  isHidden?: boolean;
}
export interface Grupo {
  id: string;
  tarefas: TarefaPrincipal[];
  customValues: Record<string, string>;
  isHidden?: boolean;
}
export type ScheduleData = Grupo[];

export interface ManpowerAllocationData {
    [role: string]: {
        [weekYear: string]: number; // e.g., "2025-29"
    };
}
export interface ManpowerAllocation {
    roles: string[];
    hasSecondShift: boolean;
    data: {
        adm: ManpowerAllocationData;
        shift2: ManpowerAllocationData;
    };
}
export interface DailyManpowerAllocation {
    [activityId: string]: {
        [date: string]: { // YYYY-MM-DD
            [role: string]: number;
        }
    }
}

export interface DynamicColumn {
  id: string;
  name: string;
  width: number;
  position?: 'before' | 'after'; // default 'before'
}

export interface Project {
  id: string;
  name: string;
  ownerId?: string;
  obra?: string;
  lastModified: number;
  title: string;
  startDate: string;
  programmerName: string;
  liveData: ScheduleData;
  savedPlan: ScheduleData | null;
  summaryData?: ScheduleData;
  manpowerAllocation: ManpowerAllocation;
  dailyManpowerAllocation: DailyManpowerAllocation;
  machines: Machine[];
  dailyMachineAllocation: DailyMachineAllocation;
  dynamicColumns: DynamicColumn[];
  displaySettings?: {
    visibleColumns?: Record<string, boolean>;
    activeFilters?: Record<string, string>;
    fixedColumnWidths?: number[];
    comparisonFixedColumnWidths?: number[];
  };
}
export type UserProjects = Record<string, Project>;

export type Page = 'schedule' | 'dashboard' | 'comparison' | 'manpower' | 'dailyAllocation' | 'manpowerDashboard' | 'machines' | 'dailyMachineAllocation' | 'dailySummary';

export enum MachineStatus {
  Funcionamento = 'Em funcionamento',
  Manutencao = 'Em manutenção',
  Descontinuada = 'Descontinuada',
}

export interface Machine {
  id: string;
  name: string;
  category: string;
  status: MachineStatus;
}

export interface DailyMachineAllocation {
  [activityId: string]: {
    [date: string]: string[]; // Array of machine IDs alocadas
  }
}

export interface RenderableRow {
    group: Grupo;
    task: TarefaPrincipal;
    activity?: Atividade;
    renderGroup: boolean;
    groupRowSpan: number;
    renderTask: boolean;
    taskRowSpan: number;
    wbsId: string;
    isLastInGroup: boolean;
    isLastInTask: boolean;
}

export type SelectedItem = {
    id: string;
    name: string;
    type: 'group' | 'task' | 'activity';
    wbsId: string;
};

export type ToastMessage = {
    id: number;
    message: string;
    type: 'success' | 'error';
};

// --- INITIAL DATA CONSTANTS ---
export const PREDEFINED_MANPOWER_ROLES = [
    // Supervisão
    'Supervisor de caldeiraria',
    'Supervisor de solda',
    // Ofícios
    'Caldeireiro',
    'Soldador',
    'Traçador',
    'Operador de oxicorte',
    'Tratamento térmico',
    // Inspeção
    'Inspetor de solda',
    'Inspetor de ultrassom',
    'Inspetor de RX',
    'Inspetor de dimensional',
];

export const MANPOWER_CATEGORIES = {
    'Supervisão': ['Supervisor de caldeiraria', 'Supervisor de solda'],
    'Ofícios': ['Caldeireiro', 'Soldador', 'Traçador', 'Operador de oxicorte', 'Tratamento térmico'],
    'Inspeção': ['Inspetor de solda', 'Inspetor de ultrassom', 'Inspetor de RX', 'Inspetor de dimensional'],
};

export const MACHINE_CATEGORIES = [
    'Usinagem',
    'Calandragem',
    'Corte',
    'Forno',
    'Cabine de Jato'
];

export const PREDEFINED_SECTORS = [
  'CTMSP',
  'IE',
  'IEI',
  'IEP',
  'IE-TS',
  'IPC-C',
  'IPC-M',
  'IPC-MC',
  'IPC-T',
  'IPS',
  'IPS-S',
  'IPS-TT',
  'IPU',
  'IPU-F',
  'IPU-U',
  'IQ',
  'IQ-DT',
  'IQ-LAB',
  'IQ-LP',
  'IQ-REC',
  'IQ-RT',
  'IQ-RX',
  'IQ-SOLDA',
  'IQ-UT',
  'IQ-VT'
];

export const getSectorStyle = (sector?: string): { background: string; color: string; border?: string } => {
  if (!sector) return { background: 'transparent', color: 'inherit' };
  const s = sector.trim().toUpperCase();
  
  if (s === 'CTMSP' || s.startsWith('IE')) {
    return { background: '#d9d9d9', color: '#000000', border: '1px solid #bfbfbf' };
  }
  if (s === 'IPC-C' || s === 'IPC-T') {
    return { background: '#ff3b30', color: '#ffffff', border: '1px solid #e02d22' };
  }
  if (s.startsWith('IPC')) {
    return { background: '#92d050', color: '#000000', border: '1px solid #76b039' };
  }
  if (s.startsWith('IPS')) {
    return { background: '#ffff00', color: '#000000', border: '1px solid #e6e600' };
  }
  if (s.startsWith('IPU')) {
    return { background: '#c6e0b4', color: '#000000', border: '1px solid #a8cfa8' };
  }
  if (s.startsWith('IQ')) {
    return { background: '#00b0f0', color: '#ffffff', border: '1px solid #0096cc' };
  }
  
  return { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
};

