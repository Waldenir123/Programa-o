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
    [Status.Programado]: '#fef08a',
    [Status.Realizado]: '#bbf7d0',
    [Status.Cancelado]: '#bfdbfe',
    [Status.NaoRealizado]: '#fecaca',
};
export const STATUS_COLOR_MAP_DARK: Record<Status, string> = {
    [Status.Programado]: '#ca8a04', // Dark Yellow
    [Status.Realizado]: '#15803d', // Dark Green
    [Status.Cancelado]: '#2563eb', // Dark Blue
    [Status.NaoRealizado]: '#dc2626', // Dark Red
};
export const STATUS_CYCLE: Status[] = [Status.Programado, Status.Realizado, Status.Cancelado, Status.NaoRealizado];

export interface Atividade {
  id: string;
  name: string;
  schedule: Record<string, Status>;
  sector?: string;
  isHidden?: boolean;
}
export interface TarefaPrincipal {
  id: string;
  title: string;
  fa?: string;
  activities: Atividade[];
}
export interface Grupo {
  id: string;
  tarefas: TarefaPrincipal[];
  customValues: Record<string, string>;
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
