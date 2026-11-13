import React, { useState, useMemo } from 'react';
import { Project, Machine, MachineStatus, MACHINE_CATEGORIES } from '../state/types';
import { generateId } from '../utils/dataUtils';
import { parseMachinesWithAI } from '../ai/aiAgents';
import { GoogleGenAI } from '@google/genai';

type StatusFilter = 'all' | MachineStatus;

const getStatusUiMeta = (status: MachineStatus) => {
    if (status === MachineStatus.Funcionamento) {
        return {
            label: 'Em Operação',
            shortBtn: 'Operação',
            accentColor: '#10b981',
            cardBorder: 'border-emerald-500/40',
            badgeText: 'text-emerald-700',
            badgeBg: 'bg-emerald-50',
            desc: 'Ativa e liberada para alocação diária',
        };
    }
    if (status === MachineStatus.Manutencao) {
        return {
            label: 'Em Manutenção',
            shortBtn: 'Manutenção',
            accentColor: '#f59e0b',
            cardBorder: 'border-amber-500',
            badgeText: 'text-amber-800',
            badgeBg: 'bg-amber-50',
            desc: 'Bloqueio automático na alocação diária',
        };
    }
    return {
        label: 'Disponível',
        shortBtn: 'Disponível',
        accentColor: '#64748b',
        cardBorder: 'border-slate-300',
        badgeText: 'text-slate-700',
        badgeBg: 'bg-slate-100',
        desc: 'Pronta para uso e disponível para alocação',
    };
};

const MachineIllustration: React.FC<{ category: string; status: MachineStatus }> = ({ category, status }) => {
    const isRunning = status === MachineStatus.Funcionamento;
    const isMaint = status === MachineStatus.Manutencao;

    const primaryStroke = isRunning ? '#059669' : isMaint ? '#b45309' : '#475569';
    const bodyFill = isRunning ? '#ecfdf5' : isMaint ? '#fffbeb' : '#f1f5f9';
    const accentFill = isRunning ? '#10b981' : isMaint ? '#f59e0b' : '#64748b';

    const catLower = category.toLowerCase();

    const renderEquipmentSilhouette = () => {
        if (catLower.includes('usinagem')) {
            return (
                <g>
                    {/* Base do torno / centro de usinagem */}
                    <rect x="20" y="64" width="120" height="22" rx="4" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    <rect x="26" y="34" width="38" height="30" rx="3" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    <rect x="64" y="42" width="66" height="22" rx="2" fill="#ffffff" stroke={primaryStroke} strokeWidth="1.75" />
                    {/* Placa / Eixo-árvore */}
                    <rect x="64" y="46" width="12" height="14" rx="1" fill={accentFill} opacity="0.85" />
                    <line x1="76" y1="53" x2="112" y2="53" stroke={primaryStroke} strokeWidth="2.5" />
                    <polygon points="118,46 112,53 118,60 124,60 124,46" fill={accentFill} opacity="0.7" />
                </g>
            );
        }
        if (catLower.includes('calandragem')) {
            return (
                <g>
                    {/* Base e cavaletes laterais da calandra */}
                    <rect x="22" y="66" width="116" height="20" rx="4" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    <rect x="28" y="32" width="18" height="34" rx="2" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    <rect x="114" y="32" width="18" height="34" rx="2" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    {/* 3 rolos de calandragem */}
                    <circle cx="80" cy="40" r="10" fill="#ffffff" stroke={primaryStroke} strokeWidth="2.2" />
                    <circle cx="64" cy="56" r="9" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    <circle cx="96" cy="56" r="9" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    <line x1="46" y1="48" x2="114" y2="48" stroke={accentFill} strokeWidth="2" strokeDasharray="4 3" />
                </g>
            );
        }
        if (catLower.includes('corte')) {
            return (
                <g>
                    {/* Mesa de corte plasma/oxicorte */}
                    <rect x="20" y="62" width="120" height="24" rx="3" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    {/* Gantry / Pórtico */}
                    <path d="M36 62 V32 H124 V62" fill="none" stroke={primaryStroke} strokeWidth="2.5" strokeLinejoin="round" />
                    <rect x="70" y="26" width="20" height="14" rx="2" fill={accentFill} />
                    <line x1="80" y1="40" x2="80" y2="56" stroke={primaryStroke} strokeWidth="2.5" />
                    <polygon points="75,56 85,56 80,62" fill={isRunning ? '#ef4444' : accentFill} />
                </g>
            );
        }
        if (catLower.includes('forno')) {
            return (
                <g>
                    {/* Câmara do forno industrial */}
                    <rect x="28" y="24" width="104" height="62" rx="5" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    <rect x="42" y="36" width="52" height="38" rx="3" fill="#ffffff" stroke={primaryStroke} strokeWidth="2" />
                    {/* Chama / resistência */}
                    <path
                        d="M58 66 C58 58 65 54 68 46 C71 54 78 58 78 66 C78 70 73 72 68 72 C63 72 58 70 58 66 Z"
                        fill={isRunning ? '#f97316' : accentFill}
                        opacity="0.85"
                    />
                    <rect x="104" y="38" width="18" height="24" rx="2" fill="#ffffff" stroke={primaryStroke} strokeWidth="1.5" />
                </g>
            );
        }
        if (catLower.includes('jato') || catLower.includes('cabine')) {
            return (
                <g>
                    {/* Cabine de jato abrasivo */}
                    <rect x="24" y="26" width="112" height="60" rx="5" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                    <rect x="44" y="36" width="44" height="30" rx="3" fill="#ffffff" stroke={primaryStroke} strokeWidth="1.8" />
                    <circle cx="106" cy="52" r="10" fill="#ffffff" stroke={primaryStroke} strokeWidth="1.8" />
                    <path d="M52 54 L78 44 M54 58 L76 54" stroke={accentFill} strokeWidth="2" strokeLinecap="round" />
                </g>
            );
        }
        // Silhueta industrial genérica
        return (
            <g>
                <rect x="24" y="54" width="112" height="32" rx="4" fill={bodyFill} stroke={primaryStroke} strokeWidth="2" />
                <rect x="34" y="32" width="52" height="22" rx="3" fill="#ffffff" stroke={primaryStroke} strokeWidth="2" />
                <rect x="94" y="38" width="32" height="16" rx="2" fill={accentFill} opacity="0.25" stroke={primaryStroke} strokeWidth="1.75" />
            </g>
        );
    };

    return (
        <div
            className={`relative w-full h-28 rounded-lg flex items-center justify-center overflow-hidden border ${
                isRunning
                    ? 'bg-emerald-50/50 border-emerald-200'
                    : isMaint
                      ? 'bg-amber-50/50 border-amber-200'
                      : 'bg-slate-50 border-slate-200'
            }`}
        >
            <svg viewBox="0 0 160 100" className="w-40 h-24" aria-hidden="true">
                {/* Piso técnico */}
                <line x1="10" y1="88" x2="150" y2="88" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />

                {renderEquipmentSilhouette()}

                {/* Engrenagem de estado (gira suavemente quando Em Operação) */}
                <g transform="translate(132, 24)">
                    <g className={isRunning ? 'machine-gear-spinning' : ''}>
                        <circle cx="0" cy="0" r="9" fill="#ffffff" stroke={accentFill} strokeWidth="2" />
                        <circle cx="0" cy="0" r="3.2" fill={accentFill} />
                        {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
                            <rect
                                key={deg}
                                x="-1.6"
                                y="-12.5"
                                width="3.2"
                                height="4"
                                rx="0.8"
                                fill={accentFill}
                                transform={`rotate(${deg})`}
                            />
                        ))}
                    </g>
                </g>

                {/* LED indicador no painel da máquina */}
                <circle
                    cx="26"
                    cy="22"
                    r="4.5"
                    fill={accentFill}
                    className={isRunning ? 'animate-pulse' : ''}
                />
                <circle cx="26" cy="22" r="7.5" fill="none" stroke={accentFill} strokeWidth="1.2" opacity={isRunning ? '0.55' : '0.2'} />
            </svg>

            {/* Sobreposição de Chave Inglesa quando Em Manutenção */}
            {isMaint && (
                <div
                    className="absolute inset-0 bg-amber-900/10 flex items-center justify-center pointer-events-none"
                    title="Em manutenção — Bloqueada para alocação"
                >
                    <div className="w-11 h-11 rounded-full bg-amber-500 text-white shadow-md flex items-center justify-center border-2 border-white">
                        <span className="material-icons text-[22px]">build</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export const MachineListView: React.FC<{
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    ai: GoogleGenAI | null;
    addToast: (message: string, type: 'success' | 'error') => void;
    zoomLevel: number;
}> = ({ project, setProject, ai, addToast, zoomLevel }) => {
    const [newMachineName, setNewMachineName] = useState('');
    const [newMachineCategory, setNewMachineCategory] = useState(MACHINE_CATEGORIES[0]);
    const [aiText, setAiText] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);

    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const handleAddMachine = () => {
        if (!newMachineName.trim()) return;
        const newMachine: Machine = {
            id: generateId(),
            name: newMachineName.trim(),
            category: newMachineCategory,
            status: MachineStatus.Funcionamento,
        };
        setProject(prev => (prev ? { ...prev, machines: [...prev.machines, newMachine] } : null));
        setNewMachineName('');
        addToast('Máquina adicionada com sucesso.', 'success');
    };

    const handleDeleteMachine = (id: string) => {
        if (window.confirm('Deseja excluir esta máquina?')) {
            setProject(prev => (prev ? { ...prev, machines: prev.machines.filter(m => m.id !== id) } : null));
        }
    };

    const handleUpdateMachineStatus = (id: string, status: MachineStatus) => {
        setProject(prev =>
            prev
                ? {
                      ...prev,
                      machines: prev.machines.map(m => (m.id === id ? { ...m, status } : m)),
                  }
                : null
        );
    };

    const handleParseMachines = async () => {
        if (!ai || !aiText.trim()) return;
        setIsAiLoading(true);
        try {
            const parsed = await parseMachinesWithAI(ai, aiText);
            const machinesWithIds = parsed.map(m => ({ ...m, id: generateId() }));
            setProject(prev => (prev ? { ...prev, machines: [...prev.machines, ...machinesWithIds] } : null));
            setAiText('');
            addToast(`${parsed.length} máquinas cadastradas com sucesso!`, 'success');
        } catch (e) {
            console.error(e);
            addToast('Falha ao processar máquinas com IA.', 'error');
        } finally {
            setIsAiLoading(false);
        }
    };

    const stats = useMemo(() => {
        const list = project.machines || [];
        return {
            total: list.length,
            operating: list.filter(m => m.status === MachineStatus.Funcionamento).length,
            maintenance: list.filter(m => m.status === MachineStatus.Manutencao).length,
            available: list.filter(m => m.status === MachineStatus.Descontinuada).length,
        };
    }, [project.machines]);

    const allCategories = useMemo(() => {
        const set = new Set<string>(MACHINE_CATEGORIES);
        (project.machines || []).forEach(m => {
            if (m.category) set.add(m.category);
        });
        return Array.from(set);
    }, [project.machines]);

    const filteredMachines = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return (project.machines || []).filter(m => {
            if (statusFilter !== 'all' && m.status !== statusFilter) return false;
            if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
            if (q && !m.name.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [project.machines, statusFilter, categoryFilter, searchTerm]);

    return (
        <div className="manpower-view bg-slate-50 relative" style={{ padding: '24px', zoom: zoomLevel / 100 }}>
            {/* Cabeçalho Executivo */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 m-0 tracking-tight">
                        Parque de Máquinas e Equipamentos
                    </h2>
                    <p className="text-xs text-slate-500 m-0 mt-1">
                        Controle visual de estado sincronizado em tempo real com a alocação diária de equipamentos.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => setIsDrawerOpen(prev => !prev)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold border-0 cursor-pointer transition-colors whitespace-nowrap shrink-0"
                >
                    <span className="material-icons text-[17px]">
                        {isDrawerOpen ? 'close' : 'add_circle_outline'}
                    </span>
                    {isDrawerOpen ? 'Fechar Painel de Cadastro' : 'Nova Máquina / IA'}
                </button>
            </div>

            {/* Faixa de KPIs no Topo */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
                <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`text-left bg-white rounded-xl p-4 border transition-colors cursor-pointer ${
                        statusFilter === 'all'
                            ? 'border-slate-900 ring-1 ring-slate-900/15'
                            : 'border-slate-200 hover:border-slate-300'
                    }`}
                >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 m-0">
                        Total de Equipamentos
                    </p>
                    <div className="flex items-baseline justify-between mt-1.5">
                        <span className="text-2xl font-bold text-slate-900 tabular-nums">{stats.total}</span>
                        <span className="text-xs text-slate-500">Todos os status</span>
                    </div>
                </button>

                <button
                    type="button"
                    onClick={() =>
                        setStatusFilter(prev =>
                            prev === MachineStatus.Funcionamento ? 'all' : MachineStatus.Funcionamento
                        )
                    }
                    className={`text-left bg-white rounded-xl p-4 border transition-colors cursor-pointer ${
                        statusFilter === MachineStatus.Funcionamento
                            ? 'border-emerald-600 ring-1 ring-emerald-500/20'
                            : 'border-slate-200 hover:border-emerald-300'
                    }`}
                >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 m-0">
                        Em Operação
                    </p>
                    <div className="flex items-baseline justify-between mt-1.5">
                        <span className="text-2xl font-bold text-emerald-600 tabular-nums">{stats.operating}</span>
                        <span className="text-xs text-emerald-700/80">Liberadas para uso</span>
                    </div>
                </button>

                <button
                    type="button"
                    onClick={() =>
                        setStatusFilter(prev =>
                            prev === MachineStatus.Manutencao ? 'all' : MachineStatus.Manutencao
                        )
                    }
                    className={`text-left bg-white rounded-xl p-4 border transition-colors cursor-pointer ${
                        statusFilter === MachineStatus.Manutencao
                            ? 'border-amber-600 ring-1 ring-amber-500/20'
                            : 'border-slate-200 hover:border-amber-300'
                    }`}
                >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 m-0">
                        Em Manutenção
                    </p>
                    <div className="flex items-baseline justify-between mt-1.5">
                        <span className="text-2xl font-bold text-amber-600 tabular-nums">{stats.maintenance}</span>
                        <span className="text-xs text-amber-700/80">Bloqueio automático</span>
                    </div>
                </button>

                <button
                    type="button"
                    onClick={() =>
                        setStatusFilter(prev =>
                            prev === MachineStatus.Descontinuada ? 'all' : MachineStatus.Descontinuada
                        )
                    }
                    className={`text-left bg-white rounded-xl p-4 border transition-colors cursor-pointer ${
                        statusFilter === MachineStatus.Descontinuada
                            ? 'border-slate-600 ring-1 ring-slate-500/20'
                            : 'border-slate-200 hover:border-slate-300'
                    }`}
                >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 m-0">
                        Disponível
                    </p>
                    <div className="flex items-baseline justify-between mt-1.5">
                        <span className="text-2xl font-bold text-slate-700 tabular-nums">{stats.available}</span>
                        <span className="text-xs text-slate-500">Prontas para uso</span>
                    </div>
                </button>
            </div>

            {/* Barra de Filtros Rápidos por Status, Categoria e Busca */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        {[
                            { value: 'all' as StatusFilter, label: 'Todas' },
                            { value: MachineStatus.Funcionamento, label: 'Em Operação' },
                            { value: MachineStatus.Manutencao, label: 'Em Manutenção' },
                            { value: MachineStatus.Descontinuada, label: 'Disponível' },
                        ].map(tab => (
                            <button
                                key={tab.value}
                                type="button"
                                onClick={() => setStatusFilter(tab.value)}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold border-0 cursor-pointer transition-colors whitespace-nowrap ${
                                    statusFilter === tab.value
                                        ? 'bg-white text-slate-900 shadow-sm'
                                        : 'bg-transparent text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <select
                        aria-label="Filtrar por categoria"
                        value={categoryFilter}
                        onChange={e => setCategoryFilter(e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-slate-400 cursor-pointer"
                    >
                        <option value="all">Todas as categorias</option>
                        {allCategories.map(cat => (
                            <option key={cat} value={cat}>
                                {cat}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="relative">
                    <span className="material-icons text-[16px] text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        search
                    </span>
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Buscar equipamento..."
                        className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-400 w-56"
                    />
                </div>
            </div>

            {/* Conteúdo Principal: Grade de Cards + Painel Lateral Recolhível */}
            <div className={`grid gap-5 items-start ${isDrawerOpen ? 'grid-cols-1 xl:grid-cols-12' : 'grid-cols-1'}`}>
                <div className={isDrawerOpen ? 'xl:col-span-8' : ''}>
                    {filteredMachines.length === 0 ? (
                        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                            <span className="material-icons text-4xl text-slate-300 mb-2">precision_manufacturing</span>
                            <h3 className="text-sm font-semibold text-slate-800 m-0">
                                Nenhum equipamento encontrado
                            </h3>
                            <p className="text-xs text-slate-500 mt-1 mb-4">
                                {project.machines.length === 0
                                    ? 'Cadastre a primeira máquina manualmente ou cole uma lista no painel de IA.'
                                    : 'Ajuste os filtros de status, categoria ou busca para visualizar seus equipamentos.'}
                            </p>
                            <button
                                type="button"
                                onClick={() => setIsDrawerOpen(true)}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold border-0 cursor-pointer"
                            >
                                <span className="material-icons text-[16px]">add</span>
                                Cadastrar Máquina
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredMachines.map(machine => {
                                const ui = getStatusUiMeta(machine.status);
                                const isMaint = machine.status === MachineStatus.Manutencao;
                                const isOp = machine.status === MachineStatus.Funcionamento;

                                return (
                                    <div
                                        key={machine.id}
                                        className={`bg-white rounded-xl border overflow-hidden flex flex-col justify-between transition-shadow hover:shadow-md ${ui.cardBorder}`}
                                    >
                                        {/* Faixa superior listrada de alerta âmbar somente quando Em Manutenção */}
                                        {isMaint && <div className="h-2.5 w-full machine-hazard-stripe border-b border-amber-400" />}

                                        <div className="p-4 flex flex-col gap-3 flex-1">
                                            {/* Cabeçalho do Card */}
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <h3
                                                        className="text-sm font-bold text-slate-900 m-0 truncate"
                                                        title={machine.name}
                                                    >
                                                        {machine.name}
                                                    </h3>
                                                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                                                        <span>{machine.category}</span>
                                                        <span aria-hidden="true">·</span>
                                                        <span className={`font-semibold ${ui.badgeText}`}>{ui.label}</span>
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteMachine(machine.id)}
                                                    title="Excluir máquina"
                                                    className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 bg-transparent border-0 cursor-pointer transition-colors shrink-0"
                                                >
                                                    <span className="material-icons text-[18px]">delete_outline</span>
                                                </button>
                                            </div>

                                            {/* Ilustração Vetorial SVG do Equipamento */}
                                            <MachineIllustration category={machine.category} status={machine.status} />

                                            {/* Linha informativa de estado */}
                                            <div className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium flex items-center gap-1.5 ${ui.badgeBg} ${ui.badgeText}`}>
                                                <span className="material-icons text-[14px]">
                                                    {isOp ? 'check_circle' : isMaint ? 'lock' : 'inventory'}
                                                </span>
                                                <span className="truncate">{ui.desc}</span>
                                            </div>
                                        </div>

                                        {/* Rodapé com troca rápida de status sincronizada */}
                                        <div className="px-3 py-2.5 bg-slate-50 border-t border-slate-200 grid grid-cols-3 gap-1.5">
                                            {[
                                                {
                                                    target: MachineStatus.Funcionamento,
                                                    label: 'Operação',
                                                    activeCls: 'bg-emerald-600 text-white border-emerald-600',
                                                },
                                                {
                                                    target: MachineStatus.Manutencao,
                                                    label: 'Manutenção',
                                                    activeCls: 'bg-amber-500 text-white border-amber-500',
                                                },
                                                {
                                                    target: MachineStatus.Descontinuada,
                                                    label: 'Disponível',
                                                    activeCls: 'bg-slate-600 text-white border-slate-600',
                                                },
                                            ].map(btn => {
                                                const active = machine.status === btn.target;
                                                return (
                                                    <button
                                                        key={btn.target}
                                                        type="button"
                                                        onClick={() => handleUpdateMachineStatus(machine.id, btn.target)}
                                                        className={`py-1.5 px-2 rounded-md text-[11px] font-semibold border cursor-pointer transition-colors whitespace-nowrap ${
                                                            active
                                                                ? btn.activeCls
                                                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        {btn.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Painel Lateral Recolhível: Nova Máquina + Registro por IA */}
                {isDrawerOpen && (
                    <aside className="xl:col-span-4 flex flex-col gap-4 sticky top-4">
                        <div className="bg-white rounded-xl border border-slate-200 p-5">
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-sm font-bold text-slate-900 m-0 flex items-center gap-2">
                                    <span className="material-icons text-[18px] text-sky-600">add_circle</span>
                                    Nova Máquina
                                </h4>
                                <button
                                    type="button"
                                    onClick={() => setIsDrawerOpen(false)}
                                    className="p-1 rounded text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer"
                                    title="Recolher painel"
                                >
                                    <span className="material-icons text-[18px]">close</span>
                                </button>
                            </div>
                            <div className="flex flex-col gap-3">
                                <input
                                    type="text"
                                    placeholder="Nome da máquina..."
                                    value={newMachineName}
                                    onChange={e => setNewMachineName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddMachine()}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-slate-500"
                                />
                                <select
                                    value={newMachineCategory}
                                    onChange={e => setNewMachineCategory(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white focus:outline-none focus:border-slate-500 cursor-pointer"
                                >
                                    {MACHINE_CATEGORIES.map(cat => (
                                        <option key={cat} value={cat}>
                                            {cat}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={handleAddMachine}
                                    className="w-full py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold border-0 cursor-pointer transition-colors"
                                >
                                    Adicionar Equipamento
                                </button>
                            </div>
                        </div>

                        <div className="bg-sky-50/70 rounded-xl border border-sky-200 p-5">
                            <h4 className="text-sm font-bold text-sky-900 m-0 mb-2 flex items-center gap-2">
                                <span className="material-icons text-[18px] text-sky-600">psychology</span>
                                Registro por IA
                            </h4>
                            <p className="text-xs text-sky-800 m-0 mb-3">
                                Cole uma lista de máquinas e suas descrições para cadastrar em massa.
                            </p>
                            <textarea
                                value={aiText}
                                onChange={e => setAiText(e.target.value)}
                                placeholder="Ex: Torno CNC Romi em funcionamento, Calandra de chapas em manutenção..."
                                className="w-full h-28 p-2.5 rounded-lg border border-sky-200 bg-white text-xs text-slate-900 mb-3 focus:outline-none focus:border-sky-400"
                            />
                            <button
                                type="button"
                                onClick={handleParseMachines}
                                disabled={isAiLoading || !aiText.trim()}
                                className="w-full py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold border-0 cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                            >
                                {isAiLoading ? (
                                    'Processando...'
                                ) : (
                                    <>
                                        <span className="material-icons text-[16px]">bolt</span>
                                        Cadastrar via IA
                                    </>
                                )}
                            </button>
                        </div>
                    </aside>
                )}
            </div>
        </div>
    );
};
