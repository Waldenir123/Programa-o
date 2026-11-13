import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import Chart, { Plugin } from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import {
    Project,
    ScheduleData,
    Status,
    STATUS_LABELS,
    DynamicColumn,
    MANPOWER_CATEGORIES,
    getSectorStyle,
} from '../state/types';
import {
    exportScheduleDashboardPdf,
    exportManpowerDashboardPdf,
} from '../utils/exportAgents';
import {
    getWeek,
    getWeekYear,
    getDatesOfWeek,
    getDateRangeOfWeek,
    getNextWorkingDay,
    formatDate,
} from '../utils/dataUtils';

interface DashboardViewProps {
    data: ScheduleData;
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    dates: Date[];
    title: string;
    programmerName: string;
    dynamicColumns: DynamicColumn[];
    initialTab?: 'schedule' | 'manpower';
    onMarkActivityDone?: (activityId: string, dateStr: string) => void;
    onRescheduleActivity?: (activityId: string, fromDateStr: string, targetDateStr: string) => void;
}

interface ScheduleOccurrence {
    id: string;
    activityId: string;
    taskId: string;
    dateStr: string;
    dateObj: Date;
    weekNum: number;
    weekYear: string;
    sector: string;
    faKey: string;
    faLabel: string;
    componentName: string;
    taskTitle: string;
    activityName: string;
    rawStatus: Status;
    effectiveStatus: Status;
    isPastWeek: boolean;
    wasPastProgramado: boolean;
}

type MoCategory = 'Supervisão' | 'Ofícios' | 'Inspeção' | 'Outros';
type MoShiftFilter = 'all' | 'adm' | 'shift2';

const MO_CATEGORY_ORDER: MoCategory[] = ['Supervisão', 'Ofícios', 'Inspeção', 'Outros'];
const MO_CATEGORY_COLORS: Record<MoCategory, { fill: string; dot: string; badge: string }> = {
    'Supervisão': {
        fill: '#38bdf8',
        dot: 'bg-sky-400',
        badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    },
    'Ofícios': {
        fill: '#10b981',
        dot: 'bg-emerald-500',
        badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    },
    'Inspeção': {
        fill: '#f59e0b',
        dot: 'bg-amber-500',
        badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    },
    'Outros': {
        fill: '#a855f7',
        dot: 'bg-purple-500',
        badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    },
};

const getRoleCategory = (role: string): MoCategory => {
    const normalized = role.trim().toLowerCase();
    for (const [cat, roles] of Object.entries(MANPOWER_CATEGORIES)) {
        if (roles.some(r => r.trim().toLowerCase() === normalized)) {
            return cat as MoCategory;
        }
    }
    return 'Outros';
};

const stripHtml = (val?: string | null): string => {
    if (!val) return '';
    return val
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
};

const formatFaLabel = (rawFa: string): string => {
    if (!rawFa || rawFa === 'Sem FA') return 'Sem FA';
    if (/^fa[\s\-:]/i.test(rawFa)) return rawFa.toUpperCase();
    return `FA ${rawFa}`;
};

const formatDateBr = (dateStr: string): string => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    if (!y || !m || !d) return dateStr;
    return `${d}/${m}/${y}`;
};

const STATUS_CHART_COLORS: Record<Status, { fill: string; border: string; text: string; dot: string }> = {
    [Status.Realizado]: {
        fill: '#10b981',
        border: '#059669',
        text: 'text-emerald-400',
        dot: 'bg-emerald-500',
    },
    [Status.NaoRealizado]: {
        fill: '#f43f5e',
        border: '#e11d48',
        text: 'text-rose-400',
        dot: 'bg-rose-500',
    },
    [Status.Cancelado]: {
        fill: '#64748b',
        border: '#475569',
        text: 'text-slate-300',
        dot: 'bg-slate-500',
    },
    [Status.Programado]: {
        fill: '#f59e0b',
        border: '#d97706',
        text: 'text-amber-400',
        dot: 'bg-amber-500',
    },
};

export const DashboardView: React.FC<DashboardViewProps> = ({
    data,
    project,
    setProject,
    dates,
    title,
    programmerName,
    dynamicColumns,
    initialTab = 'schedule',
    onMarkActivityDone,
    onRescheduleActivity,
}) => {
    const [activeTab, setActiveTab] = useState<'schedule' | 'manpower'>(initialTab);

    useEffect(() => {
        setActiveTab(initialTab);
    }, [initialTab]);

    // Schedule Chart Refs
    const dailyChartRef = useRef<HTMLCanvasElement>(null);
    const dailyChartInstance = useRef<Chart | null>(null);
    const sectorChartRef = useRef<HTMLCanvasElement>(null);
    const sectorChartInstance = useRef<Chart | null>(null);
    const doughnutChartRef = useRef<HTMLCanvasElement>(null);
    const doughnutChartInstance = useRef<Chart | null>(null);

    // Manpower Chart Refs
    const moHistogramChartRef = useRef<HTMLCanvasElement>(null);
    const moHistogramChartInstance = useRef<Chart | null>(null);
    const moCategoryChartRef = useRef<HTMLCanvasElement>(null);
    const moCategoryChartInstance = useRef<Chart | null>(null);
    const moRolesChartRef = useRef<HTMLCanvasElement>(null);
    const moRolesChartInstance = useRef<Chart | null>(null);

    // --- SCHEDULE DASHBOARD STATE ---
    const [selectedWeek, setSelectedWeek] = useState<string>('all');
    const [selectedSector, setSelectedSector] = useState<string>('all');
    const [selectedFa, setSelectedFa] = useState<string>('all');
    const [selectedStatus, setSelectedStatus] = useState<Status | 'all'>('all');
    const [targetAdherence, setTargetAdherence] = useState<number>(85);
    const [dailyChartMode, setDailyChartMode] = useState<'daily' | 'curveS'>('daily');
    const [sectorChartMode, setSectorChartMode] = useState<'ranking' | 'volume'>('ranking');
    const [faSortMode, setFaSortMode] = useState<'pending' | 'lowestPct' | 'highestPct'>('pending');
    const [actionFilterStatus, setActionFilterStatus] = useState<'all' | Status.NaoRealizado | Status.Cancelado>('all');
    const [actionSearch, setActionSearch] = useState<string>('');
    const [reschedulingRowId, setReschedulingRowId] = useState<string | null>(null);
    const [rescheduleTargetDate, setRescheduleTargetDate] = useState<string>('');

    // --- MANPOWER DASHBOARD STATE ---
    const [selectedMoWeek, setSelectedMoWeek] = useState<string>('');
    const [selectedShift, setSelectedShift] = useState<MoShiftFilter>('all');
    const [selectedMoCategory, setSelectedMoCategory] = useState<MoCategory | 'all'>('all');
    const [selectedMoRole, setSelectedMoRole] = useState<string>('all');

    const breakdownCol = useMemo(() => (dynamicColumns || [])[0], [dynamicColumns]);

    // ============================================================================
    // 1. SCHEDULE & ADHERENCE DATA PIPELINE
    // ============================================================================
    const { occurrences, availableWeeks, availableSectors, availableFas, futureScheduledMap } = useMemo(() => {
        const currentWeekYear = getWeekYear(new Date());
        const list: ScheduleOccurrence[] = [];
        const weekSet = new Map<string, { weekNum: number; label: string }>();
        const sectorSet = new Set<string>();
        const faMap = new Map<string, string>();
        const futureMap = new Map<string, string>();

        (data || []).forEach(group => {
            if (group?.isHidden) return;
            const componentName = breakdownCol
                ? stripHtml(group.customValues?.[breakdownCol.id]) || 'Sem Agrupador'
                : 'Sem Agrupador';

            (group.tarefas || []).forEach(task => {
                if (task?.isHidden) return;
                const rawTaskFa = stripHtml(task.fa);
                const cleanFa = rawTaskFa && rawTaskFa.toUpperCase() !== 'Nº FA' ? rawTaskFa : '';
                const faKey = cleanFa || (group.customValues?.['fa'] ? stripHtml(group.customValues['fa']) : '') || 'Sem FA';
                const faLabel = formatFaLabel(faKey);
                const taskTitle = stripHtml(task.title) || 'Sem Tarefa';

                (task.activities || []).forEach(activity => {
                    if (!activity || activity.isHidden || !activity.schedule) return;
                    const sector = stripHtml(activity.sector) || 'Sem Setor';
                    const activityName = stripHtml(activity.name) || 'Sem Atividade';

                    (Object.entries(activity.schedule) as [string, Status][]).forEach(([dateStr, rawStatus]) => {
                        if (!rawStatus) return;
                        const dateObj = new Date(dateStr + 'T00:00:00Z');
                        if (isNaN(dateObj.getTime())) return;

                        const weekNum = getWeek(dateObj);
                        const weekYear = getWeekYear(dateObj);
                        const isPastWeek = weekYear < currentWeekYear;
                        const wasPastProgramado = rawStatus === Status.Programado && isPastWeek;
                        const effectiveStatus = wasPastProgramado ? Status.NaoRealizado : rawStatus;

                        if (rawStatus === Status.Programado && !isPastWeek) {
                            const existingFuture = futureMap.get(activity.id);
                            if (!existingFuture || dateStr < existingFuture) {
                                futureMap.set(activity.id, dateStr);
                            }
                        }

                        if (!weekSet.has(weekYear)) {
                            weekSet.set(weekYear, {
                                weekNum,
                                label: `Semana ${weekNum.toString().padStart(2, '0')} (${getDateRangeOfWeek(weekYear)})`,
                            });
                        }
                        sectorSet.add(sector);
                        if (!faMap.has(faKey)) {
                            faMap.set(faKey, faLabel);
                        }

                        list.push({
                            id: `${activity.id}__${dateStr}`,
                            activityId: activity.id,
                            taskId: task.id,
                            dateStr,
                            dateObj,
                            weekNum,
                            weekYear,
                            sector,
                            faKey,
                            faLabel,
                            componentName,
                            taskTitle,
                            activityName,
                            rawStatus,
                            effectiveStatus,
                            isPastWeek,
                            wasPastProgramado,
                        });
                    });
                });
            });
        });

        const sortedWeeks = Array.from(weekSet.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([value, meta]) => ({ value, label: meta.label, weekNum: meta.weekNum }));

        const sortedSectors = Array.from(sectorSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const sortedFas = Array.from(faMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
            .map(([value, label]) => ({ value, label }));

        return {
            occurrences: list,
            availableWeeks: sortedWeeks,
            availableSectors: sortedSectors,
            availableFas: sortedFas,
            futureScheduledMap: futureMap,
        };
    }, [data, breakdownCol]);

    useEffect(() => {
        if (selectedWeek !== 'all' && !availableWeeks.some(w => w.value === selectedWeek)) {
            setSelectedWeek('all');
        }
    }, [availableWeeks, selectedWeek]);

    useEffect(() => {
        if (selectedSector !== 'all' && !availableSectors.includes(selectedSector)) {
            setSelectedSector('all');
        }
    }, [availableSectors, selectedSector]);

    useEffect(() => {
        if (selectedFa !== 'all' && !availableFas.some(f => f.value === selectedFa)) {
            setSelectedFa('all');
        }
    }, [availableFas, selectedFa]);

    const filteredOccurrences = useMemo(() => {
        return occurrences.filter(item => {
            if (selectedWeek !== 'all' && item.weekYear !== selectedWeek) return false;
            if (selectedSector !== 'all' && item.sector !== selectedSector) return false;
            if (selectedFa !== 'all' && item.faKey !== selectedFa) return false;
            if (selectedStatus !== 'all' && item.effectiveStatus !== selectedStatus) return false;
            return true;
        });
    }, [occurrences, selectedWeek, selectedSector, selectedFa, selectedStatus]);

    const kpis = useMemo(() => {
        let totalRealizado = 0;
        let totalNaoRealizado = 0;
        let totalCancelado = 0;
        let totalProgramadoOpen = 0;

        const cancelBySector = new Map<string, number>();
        const failBySector = new Map<string, number>();
        const uniqueFas = new Set<string>();

        filteredOccurrences.forEach(item => {
            uniqueFas.add(item.faKey);

            if (item.effectiveStatus === Status.Realizado) {
                totalRealizado++;
            } else if (item.effectiveStatus === Status.Cancelado) {
                totalCancelado++;
                cancelBySector.set(item.sector, (cancelBySector.get(item.sector) || 0) + 1);
            } else if (item.effectiveStatus === Status.NaoRealizado) {
                totalNaoRealizado++;
                failBySector.set(item.sector, (failBySector.get(item.sector) || 0) + 1);
            } else if (item.effectiveStatus === Status.Programado) {
                totalProgramadoOpen++;
            }
        });

        const totalCarteira = filteredOccurrences.length;
        const totalAtivas = totalCarteira - totalCancelado;
        const adherenceRate = totalAtivas > 0 ? (totalRealizado / totalAtivas) * 100 : 0;
        const adherenceDelta = adherenceRate - targetAdherence;

        const pctRealizadoCarteira = totalCarteira > 0 ? (totalRealizado / totalCarteira) * 100 : 0;
        const pctNaoRealizadoCarteira = totalCarteira > 0 ? (totalNaoRealizado / totalCarteira) * 100 : 0;
        const pctCanceladoCarteira = totalCarteira > 0 ? (totalCancelado / totalCarteira) * 100 : 0;
        const pctAtivasCarteira = totalCarteira > 0 ? (totalAtivas / totalCarteira) * 100 : 0;

        const topCancelEntry = Array.from(cancelBySector.entries()).sort((a, b) => b[1] - a[1])[0] || null;
        const topFailEntry = Array.from(failBySector.entries()).sort((a, b) => b[1] - a[1])[0] || null;

        return {
            totalRealizado,
            totalNaoRealizado,
            totalCancelado,
            totalProgramadoOpen,
            totalCarteira,
            totalAtivas,
            adherenceRate,
            adherenceDelta,
            pctRealizadoCarteira,
            pctNaoRealizadoCarteira,
            pctCanceladoCarteira,
            pctAtivasCarteira,
            topCancelEntry,
            topFailEntry,
            uniqueFaCount: uniqueFas.size,
        };
    }, [filteredOccurrences, targetAdherence]);

    const dailySeries = useMemo(() => {
        const dayMap = new Map<
            string,
            { dateStr: string; ok: number; n: number; c: number; x: number; active: number; total: number }
        >();

        filteredOccurrences.forEach(item => {
            let entry = dayMap.get(item.dateStr);
            if (!entry) {
                entry = { dateStr: item.dateStr, ok: 0, n: 0, c: 0, x: 0, active: 0, total: 0 };
                dayMap.set(item.dateStr, entry);
            }
            entry.total++;
            if (item.effectiveStatus === Status.Realizado) {
                entry.ok++;
                entry.active++;
            } else if (item.effectiveStatus === Status.NaoRealizado) {
                entry.n++;
                entry.active++;
            } else if (item.effectiveStatus === Status.Programado) {
                entry.x++;
                entry.active++;
            } else if (item.effectiveStatus === Status.Cancelado) {
                entry.c++;
            }
        });

        const sorted = Array.from(dayMap.values()).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        const totalActiveAllDays = sorted.reduce((acc, d) => acc + d.active, 0);

        let cumOk = 0;
        let cumActive = 0;

        return sorted.map(d => {
            cumOk += d.ok;
            cumActive += d.active;
            const dailyPct = d.active > 0 ? Number(((d.ok / d.active) * 100).toFixed(1)) : 0;
            const cumRealPct = totalActiveAllDays > 0 ? Number(((cumOk / totalActiveAllDays) * 100).toFixed(1)) : 0;
            const cumPlanPct = totalActiveAllDays > 0 ? Number(((cumActive / totalActiveAllDays) * 100).toFixed(1)) : 0;
            const [, m, day] = d.dateStr.split('-');
            return {
                ...d,
                label: `${day}/${m}`,
                dailyPct,
                cumRealPct,
                cumPlanPct,
            };
        });
    }, [filteredOccurrences]);

    const sectorStats = useMemo(() => {
        const map = new Map<
            string,
            { sector: string; ok: number; n: number; c: number; x: number; active: number; total: number; adherencePct: number }
        >();

        filteredOccurrences.forEach(item => {
            let entry = map.get(item.sector);
            if (!entry) {
                entry = { sector: item.sector, ok: 0, n: 0, c: 0, x: 0, active: 0, total: 0, adherencePct: 0 };
                map.set(item.sector, entry);
            }
            entry.total++;
            if (item.effectiveStatus === Status.Realizado) {
                entry.ok++;
                entry.active++;
            } else if (item.effectiveStatus === Status.NaoRealizado) {
                entry.n++;
                entry.active++;
            } else if (item.effectiveStatus === Status.Programado) {
                entry.x++;
                entry.active++;
            } else if (item.effectiveStatus === Status.Cancelado) {
                entry.c++;
            }
        });

        const list = Array.from(map.values()).map(s => ({
            ...s,
            adherencePct: s.active > 0 ? Number(((s.ok / s.active) * 100).toFixed(1)) : 0,
        }));

        if (sectorChartMode === 'ranking') {
            return list.sort((a, b) => a.adherencePct - b.adherencePct || b.n - a.n || a.sector.localeCompare(b.sector, 'pt-BR'));
        }
        return list.sort((a, b) => b.total - a.total || a.sector.localeCompare(b.sector, 'pt-BR'));
    }, [filteredOccurrences, sectorChartMode]);

    const faStats = useMemo(() => {
        const map = new Map<
            string,
            {
                faKey: string;
                faLabel: string;
                sectorCounts: Map<string, number>;
                ok: number;
                n: number;
                c: number;
                x: number;
                active: number;
                total: number;
            }
        >();

        filteredOccurrences.forEach(item => {
            let entry = map.get(item.faKey);
            if (!entry) {
                entry = {
                    faKey: item.faKey,
                    faLabel: item.faLabel,
                    sectorCounts: new Map(),
                    ok: 0,
                    n: 0,
                    c: 0,
                    x: 0,
                    active: 0,
                    total: 0,
                };
                map.set(item.faKey, entry);
            }
            entry.total++;
            entry.sectorCounts.set(item.sector, (entry.sectorCounts.get(item.sector) || 0) + 1);

            if (item.effectiveStatus === Status.Realizado) {
                entry.ok++;
                entry.active++;
            } else if (item.effectiveStatus === Status.NaoRealizado) {
                entry.n++;
                entry.active++;
            } else if (item.effectiveStatus === Status.Programado) {
                entry.x++;
                entry.active++;
            } else if (item.effectiveStatus === Status.Cancelado) {
                entry.c++;
            }
        });

        const list = Array.from(map.values()).map(entry => {
            const topSectorEntry = Array.from(entry.sectorCounts.entries()).sort((a, b) => b[1] - a[1])[0];
            const primarySector = topSectorEntry ? topSectorEntry[0] : 'Sem Setor';
            const extraSectors = Math.max(0, entry.sectorCounts.size - 1);
            const pctCompleted = entry.active > 0 ? Number(((entry.ok / entry.active) * 100).toFixed(1)) : 0;
            const pendingCount = entry.n + entry.x;
            return {
                ...entry,
                primarySector,
                extraSectors,
                pctCompleted,
                pendingCount,
            };
        });

        if (faSortMode === 'pending') {
            return list.sort((a, b) => b.pendingCount - a.pendingCount || a.pctCompleted - b.pctCompleted);
        }
        if (faSortMode === 'lowestPct') {
            return list.sort((a, b) => a.pctCompleted - b.pctCompleted || b.pendingCount - a.pendingCount);
        }
        return list.sort((a, b) => b.pctCompleted - a.pctCompleted || b.ok - a.ok);
    }, [filteredOccurrences, faSortMode]);

    const actionPlanRows = useMemo(() => {
        const searchLower = actionSearch.trim().toLowerCase();
        return filteredOccurrences
            .filter(item => {
                const isNC =
                    item.effectiveStatus === Status.NaoRealizado || item.effectiveStatus === Status.Cancelado;
                if (!isNC) return false;
                if (actionFilterStatus !== 'all' && item.effectiveStatus !== actionFilterStatus) return false;
                if (searchLower) {
                    const hay = `${item.faLabel} ${item.sector} ${item.taskTitle} ${item.activityName} ${item.dateStr}`.toLowerCase();
                    if (!hay.includes(searchLower)) return false;
                }
                return true;
            })
            .sort((a, b) => {
                if (a.effectiveStatus !== b.effectiveStatus) {
                    return a.effectiveStatus === Status.NaoRealizado ? -1 : 1;
                }
                return b.dateStr.localeCompare(a.dateStr) || a.sector.localeCompare(b.sector, 'pt-BR');
            });
    }, [filteredOccurrences, actionFilterStatus, actionSearch]);

    const hasScheduleActiveFilters =
        selectedWeek !== 'all' ||
        selectedSector !== 'all' ||
        selectedFa !== 'all' ||
        selectedStatus !== 'all';

    const clearScheduleFilters = useCallback(() => {
        setSelectedWeek('all');
        setSelectedSector('all');
        setSelectedFa('all');
        setSelectedStatus('all');
    }, []);

    // --- SCHEDULE CHART 1: Daily / Curva S ---
    useEffect(() => {
        if (activeTab !== 'schedule') return;
        const canvas = dailyChartRef.current;
        if (!canvas) return;
        if (dailyChartInstance.current) {
            dailyChartInstance.current.destroy();
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const metaLinePlugin: Plugin = {
            id: 'targetMetaHorizontalLine',
            afterDatasetsDraw(chart) {
                const { ctx: c, chartArea, scales } = chart;
                const yScale = scales.y;
                if (!yScale || !chartArea) return;
                const yPos = yScale.getPixelForValue(targetAdherence);
                if (yPos < chartArea.top - 5 || yPos > chartArea.bottom + 5) return;

                c.save();
                c.beginPath();
                c.setLineDash([6, 4]);
                c.lineWidth = 1.75;
                c.strokeStyle = '#38bdf8';
                c.moveTo(chartArea.left, yPos);
                c.lineTo(chartArea.right, yPos);
                c.stroke();

                const labelText = `Meta ${targetAdherence}%`;
                c.font = '600 11px Inter, sans-serif';
                const textW = c.measureText(labelText).width;
                const boxX = Math.max(chartArea.left + 4, chartArea.right - textW - 14);
                const boxY = Math.max(chartArea.top + 2, yPos - 20);
                c.fillStyle = 'rgba(15, 23, 42, 0.9)';
                c.strokeStyle = '#38bdf8';
                c.lineWidth = 1;
                c.beginPath();
                c.roundRect(boxX, boxY, textW + 10, 17, 4);
                c.fill();
                c.stroke();

                c.fillStyle = '#38bdf8';
                c.textAlign = 'left';
                c.textBaseline = 'middle';
                c.fillText(labelText, boxX + 5, boxY + 8.5);
                c.restore();
            },
        };

        const labels = dailySeries.map(d => d.label);

        if (dailyChartMode === 'daily') {
            dailyChartInstance.current = new Chart(ctx, {
                type: 'bar',
                plugins: [metaLinePlugin],
                data: {
                    labels,
                    datasets: [
                        {
                            label: '% Atingimento Diário (OK / Ativas)',
                            data: dailySeries.map(d => d.dailyPct),
                            backgroundColor: dailySeries.map(d =>
                                d.active === 0
                                    ? 'rgba(100, 116, 139, 0.35)'
                                    : d.dailyPct >= targetAdherence
                                      ? 'rgba(16, 185, 129, 0.85)'
                                      : d.dailyPct >= targetAdherence - 20
                                        ? 'rgba(245, 158, 11, 0.85)'
                                        : 'rgba(244, 63, 94, 0.85)'
                            ),
                            borderRadius: 5,
                            maxBarThickness: 36,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            labels: { color: '#cbd5e1', font: { size: 11 } },
                        },
                        tooltip: {
                            backgroundColor: '#0f172a',
                            borderColor: '#334155',
                            borderWidth: 1,
                            titleColor: '#f8fafc',
                            bodyColor: '#cbd5e1',
                            callbacks: {
                                label: ctxItem => {
                                    const d = dailySeries[ctxItem.dataIndex];
                                    if (!d) return '';
                                    return [
                                        `Atingimento: ${d.dailyPct}% (Meta: ${targetAdherence}%)`,
                                        `OK: ${d.ok} | Não Real.: ${d.n} | Prog.: ${d.x} | Canc.: ${d.c}`,
                                    ];
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            ticks: { color: '#94a3b8', font: { size: 11 } },
                            grid: { display: false },
                        },
                        y: {
                            min: 0,
                            max: 100,
                            ticks: {
                                color: '#94a3b8',
                                font: { size: 11 },
                                callback: val => `${val}%`,
                            },
                            grid: { color: 'rgba(148, 163, 184, 0.12)' },
                        },
                    },
                },
            });
        } else {
            dailyChartInstance.current = new Chart(ctx, {
                type: 'line',
                plugins: [metaLinePlugin],
                data: {
                    labels,
                    datasets: [
                        {
                            label: '% Realizado Acumulado (Curva S)',
                            data: dailySeries.map(d => d.cumRealPct),
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.15)',
                            fill: true,
                            tension: 0.3,
                            borderWidth: 2.5,
                            pointRadius: 3.5,
                            pointBackgroundColor: '#10b981',
                        },
                        {
                            label: '% Previsto Acumulado (Baseline Ativa)',
                            data: dailySeries.map(d => d.cumPlanPct),
                            borderColor: '#94a3b8',
                            borderDash: [5, 5],
                            backgroundColor: 'transparent',
                            fill: false,
                            tension: 0.3,
                            borderWidth: 2,
                            pointRadius: 2.5,
                            pointBackgroundColor: '#94a3b8',
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            labels: { color: '#cbd5e1', font: { size: 11 } },
                        },
                        tooltip: {
                            backgroundColor: '#0f172a',
                            borderColor: '#334155',
                            borderWidth: 1,
                            titleColor: '#f8fafc',
                            bodyColor: '#cbd5e1',
                            callbacks: {
                                label: ctxItem => `${ctxItem.dataset.label}: ${ctxItem.parsed.y}%`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            ticks: { color: '#94a3b8', font: { size: 11 } },
                            grid: { display: false },
                        },
                        y: {
                            min: 0,
                            max: 100,
                            ticks: {
                                color: '#94a3b8',
                                font: { size: 11 },
                                callback: val => `${val}%`,
                            },
                            grid: { color: 'rgba(148, 163, 184, 0.12)' },
                        },
                    },
                },
            });
        }

        return () => {
            if (dailyChartInstance.current) {
                dailyChartInstance.current.destroy();
            }
        };
    }, [activeTab, dailySeries, dailyChartMode, targetAdherence]);

    // --- SCHEDULE CHART 2: Sector Horizontal Ranking / Volume ---
    useEffect(() => {
        if (activeTab !== 'schedule') return;
        const canvas = sectorChartRef.current;
        if (!canvas) return;
        if (sectorChartInstance.current) {
            sectorChartInstance.current.destroy();
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const verticalMetaPlugin: Plugin = {
            id: 'targetMetaVerticalLine',
            afterDatasetsDraw(chart) {
                if (sectorChartMode !== 'ranking') return;
                const { ctx: c, chartArea, scales } = chart;
                const xScale = scales.x;
                if (!xScale || !chartArea) return;
                const xPos = xScale.getPixelForValue(targetAdherence);
                if (xPos < chartArea.left - 5 || xPos > chartArea.right + 5) return;

                c.save();
                c.beginPath();
                c.setLineDash([5, 4]);
                c.lineWidth = 1.5;
                c.strokeStyle = '#38bdf8';
                c.moveTo(xPos, chartArea.top);
                c.lineTo(xPos, chartArea.bottom);
                c.stroke();
                c.restore();
            },
        };

        const labels = sectorStats.map(s => s.sector);

        if (sectorChartMode === 'ranking') {
            sectorChartInstance.current = new Chart(ctx, {
                type: 'bar',
                plugins: [verticalMetaPlugin, ChartDataLabels],
                data: {
                    labels,
                    datasets: [
                        {
                            label: '% Aderência Efetiva',
                            data: sectorStats.map(s => s.adherencePct),
                            backgroundColor: sectorStats.map(s => {
                                if (selectedSector !== 'all' && s.sector === selectedSector) {
                                    return '#38bdf8';
                                }
                                if (s.adherencePct >= targetAdherence) return '#10b981';
                                if (s.adherencePct >= targetAdherence - 20) return '#f59e0b';
                                return '#f43f5e';
                            }),
                            borderRadius: 4,
                            barThickness: 18,
                        },
                    ],
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (_event, elements) => {
                        if (elements.length > 0) {
                            const idx = elements[0].index;
                            const clickedSector = sectorStats[idx]?.sector;
                            if (clickedSector) {
                                setSelectedSector(prev => (prev === clickedSector ? 'all' : clickedSector));
                            }
                        }
                    },
                    onHover: (event, elements) => {
                        if (event.native?.target) {
                            (event.native.target as HTMLElement).style.cursor = elements.length > 0 ? 'pointer' : 'default';
                        }
                    },
                    layout: {
                        padding: { right: 42 },
                    },
                    plugins: {
                        legend: { display: false },
                        datalabels: {
                            anchor: 'end',
                            align: 'right',
                            color: '#e2e8f0',
                            font: { weight: 'bold', size: 11 },
                            formatter: val => `${val}%`,
                        },
                        tooltip: {
                            backgroundColor: '#0f172a',
                            borderColor: '#334155',
                            borderWidth: 1,
                            titleColor: '#f8fafc',
                            bodyColor: '#cbd5e1',
                            callbacks: {
                                label: ctxItem => {
                                    const s = sectorStats[ctxItem.dataIndex];
                                    if (!s) return '';
                                    return [
                                        `Aderência: ${s.adherencePct}% (${s.ok}/${s.active} ativas)`,
                                        `OK: ${s.ok} | Não Real.: ${s.n} | Prog.: ${s.x} | Canc.: ${s.c}`,
                                        'Clique para filtrar por este setor',
                                    ];
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            min: 0,
                            max: 100,
                            ticks: {
                                color: '#94a3b8',
                                font: { size: 11 },
                                callback: v => `${v}%`,
                            },
                            grid: { color: 'rgba(148, 163, 184, 0.12)' },
                        },
                        y: {
                            ticks: {
                                color: '#e2e8f0',
                                font: { size: 11, weight: 'bold' },
                                autoSkip: false,
                            },
                            grid: { display: false },
                        },
                    },
                },
            });
        } else {
            sectorChartInstance.current = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Realizado (OK)',
                            data: sectorStats.map(s => s.ok),
                            backgroundColor: '#10b981',
                            borderRadius: 2,
                        },
                        {
                            label: 'Programado (X)',
                            data: sectorStats.map(s => s.x),
                            backgroundColor: '#f59e0b',
                            borderRadius: 2,
                        },
                        {
                            label: 'Não Realizado (N)',
                            data: sectorStats.map(s => s.n),
                            backgroundColor: '#f43f5e',
                            borderRadius: 2,
                        },
                        {
                            label: 'Cancelado (C)',
                            data: sectorStats.map(s => s.c),
                            backgroundColor: '#64748b',
                            borderRadius: 2,
                        },
                    ],
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (_event, elements) => {
                        if (elements.length > 0) {
                            const idx = elements[0].index;
                            const clickedSector = sectorStats[idx]?.sector;
                            if (clickedSector) {
                                setSelectedSector(prev => (prev === clickedSector ? 'all' : clickedSector));
                            }
                        }
                    },
                    onHover: (event, elements) => {
                        if (event.native?.target) {
                            (event.native.target as HTMLElement).style.cursor = elements.length > 0 ? 'pointer' : 'default';
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 12 },
                        },
                        tooltip: {
                            backgroundColor: '#0f172a',
                            borderColor: '#334155',
                            borderWidth: 1,
                            titleColor: '#f8fafc',
                            bodyColor: '#cbd5e1',
                        },
                    },
                    scales: {
                        x: {
                            stacked: true,
                            ticks: { color: '#94a3b8', font: { size: 11 } },
                            grid: { color: 'rgba(148, 163, 184, 0.12)' },
                        },
                        y: {
                            stacked: true,
                            ticks: { color: '#e2e8f0', font: { size: 11, weight: 'bold' }, autoSkip: false },
                            grid: { display: false },
                        },
                    },
                },
            });
        }

        return () => {
            if (sectorChartInstance.current) {
                sectorChartInstance.current.destroy();
            }
        };
    }, [activeTab, sectorStats, sectorChartMode, targetAdherence, selectedSector]);

    // --- SCHEDULE CHART 3: Doughnut Status ---
    const doughnutItems = useMemo(
        () => [
            {
                status: Status.Realizado,
                label: STATUS_LABELS[Status.Realizado],
                count: kpis.totalRealizado,
                color: STATUS_CHART_COLORS[Status.Realizado].fill,
            },
            {
                status: Status.NaoRealizado,
                label: STATUS_LABELS[Status.NaoRealizado],
                count: kpis.totalNaoRealizado,
                color: STATUS_CHART_COLORS[Status.NaoRealizado].fill,
            },
            {
                status: Status.Cancelado,
                label: STATUS_LABELS[Status.Cancelado],
                count: kpis.totalCancelado,
                color: STATUS_CHART_COLORS[Status.Cancelado].fill,
            },
            ...(kpis.totalProgramadoOpen > 0
                ? [
                      {
                          status: Status.Programado,
                          label: STATUS_LABELS[Status.Programado],
                          count: kpis.totalProgramadoOpen,
                          color: STATUS_CHART_COLORS[Status.Programado].fill,
                      },
                  ]
                : []),
        ],
        [kpis]
    );

    useEffect(() => {
        if (activeTab !== 'schedule') return;
        const canvas = doughnutChartRef.current;
        if (!canvas) return;
        if (doughnutChartInstance.current) {
            doughnutChartInstance.current.destroy();
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const totalSlices = doughnutItems.reduce((sum, item) => sum + item.count, 0);

        doughnutChartInstance.current = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: doughnutItems.map(i => i.label),
                datasets: [
                    {
                        data: totalSlices > 0 ? doughnutItems.map(i => i.count) : [1],
                        backgroundColor: totalSlices > 0 ? doughnutItems.map(i => i.color) : ['#1e293b'],
                        borderColor: '#0f172a',
                        borderWidth: 3,
                        hoverOffset: 6,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                onClick: (_event, elements) => {
                    if (totalSlices === 0) return;
                    if (elements.length > 0) {
                        const clicked = doughnutItems[elements[0].index];
                        if (clicked) {
                            setSelectedStatus(prev => (prev === clicked.status ? 'all' : clicked.status));
                        }
                    }
                },
                onHover: (event, elements) => {
                    if (event.native?.target) {
                        (event.native.target as HTMLElement).style.cursor =
                            totalSlices > 0 && elements.length > 0 ? 'pointer' : 'default';
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: totalSlices > 0,
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#cbd5e1',
                        callbacks: {
                            label: ctxItem => {
                                const item = doughnutItems[ctxItem.dataIndex];
                                if (!item || totalSlices === 0) return '';
                                const pct = ((item.count / totalSlices) * 100).toFixed(1);
                                return `${item.label}: ${item.count} (${pct}%) — clique para filtrar`;
                            },
                        },
                    },
                },
            },
        });

        return () => {
            if (doughnutChartInstance.current) {
                doughnutChartInstance.current.destroy();
            }
        };
    }, [activeTab, doughnutItems]);

    // ============================================================================
    // 2. MANPOWER (MO) MANAGERIAL DATA PIPELINE
    // ============================================================================
    const allMoWeeks = useMemo(() => {
        const weekSet = new Set<string>();
        (dates || []).forEach(d => weekSet.add(getWeekYear(d)));
        const { adm, shift2 } = project.manpowerAllocation.data;
        Object.values(adm || {}).forEach(roleData => Object.keys(roleData || {}).forEach(w => weekSet.add(w)));
        Object.values(shift2 || {}).forEach(roleData => Object.keys(roleData || {}).forEach(w => weekSet.add(w)));
        Object.values(project.dailyManpowerAllocation || {}).forEach(actAlloc => {
            Object.keys(actAlloc || {}).forEach(dateStr => {
                const dt = new Date(dateStr + 'T00:00:00Z');
                if (!isNaN(dt.getTime())) weekSet.add(getWeekYear(dt));
            });
        });
        return Array.from(weekSet)
            .sort()
            .map(w => ({
                value: w,
                label: `Semana ${w.split('-')[1]} (${getDateRangeOfWeek(w)})`,
            }));
    }, [dates, project.manpowerAllocation.data, project.dailyManpowerAllocation]);

    useEffect(() => {
        if ((!selectedMoWeek || !allMoWeeks.some(w => w.value === selectedMoWeek)) && allMoWeeks.length > 0) {
            // Prefer first week that has MO data, otherwise first week in range
            const { adm, shift2 } = project.manpowerAllocation.data;
            const weekWithData = allMoWeeks.find(w =>
                project.manpowerAllocation.roles.some(
                    r => (adm[r]?.[w.value] || 0) > 0 || (shift2[r]?.[w.value] || 0) > 0
                )
            );
            setSelectedMoWeek(weekWithData ? weekWithData.value : allMoWeeks[0].value);
        }
    }, [allMoWeeks, selectedMoWeek, project.manpowerAllocation]);

    const moRolesList = useMemo(() => project.manpowerAllocation.roles || [], [project.manpowerAllocation.roles]);

    useEffect(() => {
        if (selectedMoRole !== 'all' && !moRolesList.includes(selectedMoRole)) {
            setSelectedMoRole('all');
        }
    }, [moRolesList, selectedMoRole]);

    // Seg a Sex dates for selectedMoWeek
    const moWorkdays = useMemo(() => {
        if (!selectedMoWeek) return [];
        const weekDates = getDatesOfWeek(selectedMoWeek).slice(0, 5); // Seg a Sex
        const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
        return weekDates.map((d, idx) => {
            const dateStr = formatDate(d);
            const [, m, day] = dateStr.split('-');
            return {
                dateStr,
                shortDay: dayNames[idx],
                label: `${dayNames[idx]} ${day}/${m}`,
            };
        });
    }, [selectedMoWeek]);

    // Raw daily demand by dateStr -> role from project.dailyManpowerAllocation
    const rawDailyByDateRole = useMemo(() => {
        const map: Record<string, Record<string, number>> = {};
        moWorkdays.forEach(wd => {
            map[wd.dateStr] = {};
        });
        Object.values(project.dailyManpowerAllocation || {}).forEach(actAlloc => {
            Object.entries(actAlloc || {}).forEach(([dateStr, rolesMap]) => {
                if (!map[dateStr]) return;
                Object.entries((rolesMap || {}) as Record<string, number>).forEach(([role, qty]) => {
                    if (qty > 0) {
                        map[dateStr][role] = (map[dateStr][role] || 0) + qty;
                    }
                });
            });
        });
        return map;
    }, [project.dailyManpowerAllocation, moWorkdays]);

    // Compute per-role metrics (filtered by Category, Role, Shift)
    const moRoleRows = useMemo(() => {
        const { adm, shift2 } = project.manpowerAllocation.data;
        const hasSecondShift = !!project.manpowerAllocation.hasSecondShift;

        return moRolesList
            .map(role => {
                const category = getRoleCategory(role);
                const admPlanned = selectedMoWeek ? adm[role]?.[selectedMoWeek] || 0 : 0;
                const shift2PlannedRaw = selectedMoWeek ? shift2[role]?.[selectedMoWeek] || 0 : 0;
                const shift2Planned = hasSecondShift ? shift2PlannedRaw : 0;
                const totalRolePlanned = admPlanned + shift2Planned;

                const planned =
                    selectedShift === 'adm'
                        ? admPlanned
                        : selectedShift === 'shift2'
                          ? shift2PlannedRaw
                          : totalRolePlanned;

                // Daily allocation respecting shift filter cleanly
                const dailyAllocations = moWorkdays.map(wd => {
                    const rawQty = rawDailyByDateRole[wd.dateStr]?.[role] || 0;
                    if (selectedShift === 'all') return rawQty;
                    if (totalRolePlanned > 0) {
                        const share =
                            selectedShift === 'adm'
                                ? admPlanned / totalRolePlanned
                                : shift2Planned / totalRolePlanned;
                        return Math.round(rawQty * share);
                    }
                    // When no planned capacity exists for the role, attribute unplanned demand to Turno ADM
                    return selectedShift === 'adm' ? rawQty : 0;
                });

                const peakAllocated = dailyAllocations.length > 0 ? Math.max(...dailyAllocations) : 0;
                const manDays = dailyAllocations.reduce((acc, v) => acc + v, 0);
                const deviation = planned - peakAllocated;

                return {
                    role,
                    category,
                    admPlanned,
                    shift2Planned,
                    shift2PlannedRaw,
                    planned,
                    peakAllocated,
                    manDays,
                    deviation,
                    dailyAllocations,
                };
            })
            .filter(row => {
                if (selectedMoCategory !== 'all' && row.category !== selectedMoCategory) return false;
                if (selectedMoRole !== 'all' && row.role !== selectedMoRole) return false;
                return true;
            });
    }, [
        moRolesList,
        project.manpowerAllocation,
        selectedMoWeek,
        selectedShift,
        selectedMoCategory,
        selectedMoRole,
        moWorkdays,
        rawDailyByDateRole,
    ]);

    // MO KPIs
    const moKpis = useMemo(() => {
        const totalPlanned = moRoleRows.reduce((s, r) => s + r.planned, 0);
        const totalAllocated = moRoleRows.reduce((s, r) => s + r.peakAllocated, 0);
        const netDeviation = totalPlanned - totalAllocated;
        const occupancyPct =
            totalPlanned > 0 ? (totalAllocated / totalPlanned) * 100 : totalAllocated > 0 ? 100 : 0;

        const worstDeficitRole =
            moRoleRows
                .filter(r => r.deviation < 0)
                .sort((a, b) => a.deviation - b.deviation)[0] || null;

        const shift2Total = moRoleRows.reduce((s, r) => s + r.shift2Planned, 0);
        const shift2Base = totalAllocated > 0 ? totalAllocated : totalPlanned;
        const shift2Pct = shift2Base > 0 ? (shift2Total / shift2Base) * 100 : 0;

        // Daily histogram totals (Seg..Sex)
        let peakDailyValue = 0;
        let peakDailyLabel = '—';
        const dailyTotalsByDay = moWorkdays.map((wd, dayIdx) => {
            const sum = moRoleRows.reduce((acc, r) => acc + (r.dailyAllocations[dayIdx] || 0), 0);
            if (sum > peakDailyValue) {
                peakDailyValue = sum;
                peakDailyLabel = wd.label;
            }
            return { ...wd, total: sum };
        });

        return {
            totalPlanned,
            totalAllocated,
            netDeviation,
            occupancyPct,
            worstDeficitRole,
            shift2Total,
            shift2Pct,
            peakDailyValue,
            peakDailyLabel,
            dailyTotalsByDay,
        };
    }, [moRoleRows, moWorkdays]);

    // Category Doughnut Data
    const moCategoryBreakdown = useMemo(() => {
        const useAllocatedBase = moKpis.totalAllocated > 0;
        const counts = new Map<MoCategory, number>();
        MO_CATEGORY_ORDER.forEach(c => counts.set(c, 0));

        moRoleRows.forEach(r => {
            const val = useAllocatedBase ? r.peakAllocated : r.planned;
            counts.set(r.category, (counts.get(r.category) || 0) + val);
        });

        const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
        return {
            useAllocatedBase,
            total,
            items: MO_CATEGORY_ORDER.map(category => {
                const count = counts.get(category) || 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return {
                    category,
                    count,
                    pct,
                    color: MO_CATEGORY_COLORS[category].fill,
                };
            }),
        };
    }, [moRoleRows, moKpis.totalAllocated]);

    const hasMoActiveFilters =
        selectedShift !== 'all' || selectedMoCategory !== 'all' || selectedMoRole !== 'all';

    const clearMoFilters = useCallback(() => {
        setSelectedShift('all');
        setSelectedMoCategory('all');
        setSelectedMoRole('all');
    }, []);

    // Quick - / + adjustment connected directly to project.manpowerAllocation
    const handleQuickMoAdjust = useCallback(
        (role: string, delta: number) => {
            if (!selectedMoWeek) return;
            const targetShift: 'adm' | 'shift2' = selectedShift === 'shift2' ? 'shift2' : 'adm';
            setProject(prev => {
                if (!prev) return null;
                const nextAllocation = JSON.parse(JSON.stringify(prev.manpowerAllocation));
                if (!nextAllocation.data[targetShift][role]) {
                    nextAllocation.data[targetShift][role] = {};
                }
                const currentQty = nextAllocation.data[targetShift][role][selectedMoWeek] || 0;
                nextAllocation.data[targetShift][role][selectedMoWeek] = Math.max(0, currentQty + delta);
                if (targetShift === 'shift2' && delta > 0) {
                    nextAllocation.hasSecondShift = true;
                }
                return { ...prev, manpowerAllocation: nextAllocation };
            });
        },
        [selectedMoWeek, selectedShift, setProject]
    );

    // --- MO CHART 1: Histograma Diário Seg a Sex (Empilhado por Categoria + Linha Capacidade Planejada) ---
    useEffect(() => {
        if (activeTab !== 'manpower') return;
        const canvas = moHistogramChartRef.current;
        if (!canvas) return;
        if (moHistogramChartInstance.current) {
            moHistogramChartInstance.current.destroy();
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const capacityLinePlugin: Plugin = {
            id: 'moPlannedCapacityLine',
            afterDatasetsDraw(chart) {
                const { ctx: c, chartArea, scales } = chart;
                const yScale = scales.y;
                if (!yScale || !chartArea) return;
                const cap = moKpis.totalPlanned;
                const yPos = yScale.getPixelForValue(cap);
                if (yPos < chartArea.top - 5 || yPos > chartArea.bottom + 5) return;

                c.save();
                c.beginPath();
                c.setLineDash([6, 4]);
                c.lineWidth = 1.75;
                c.strokeStyle = '#38bdf8';
                c.moveTo(chartArea.left, yPos);
                c.lineTo(chartArea.right, yPos);
                c.stroke();

                const labelText = `Capacidade Planejada: ${cap}`;
                c.font = '600 11px Inter, sans-serif';
                const textW = c.measureText(labelText).width;
                const boxX = Math.max(chartArea.left + 4, chartArea.right - textW - 14);
                const boxY = Math.max(chartArea.top + 2, yPos - 20);
                c.fillStyle = 'rgba(15, 23, 42, 0.92)';
                c.strokeStyle = '#38bdf8';
                c.lineWidth = 1;
                c.beginPath();
                c.roundRect(boxX, boxY, textW + 10, 17, 4);
                c.fill();
                c.stroke();

                c.fillStyle = '#38bdf8';
                c.textAlign = 'left';
                c.textBaseline = 'middle';
                c.fillText(labelText, boxX + 5, boxY + 8.5);
                c.restore();
            },
        };

        const labels = moWorkdays.map(wd => wd.label);
        const datasets = MO_CATEGORY_ORDER.map(category => ({
            label: category,
            data: moWorkdays.map((_, dayIdx) =>
                moRoleRows
                    .filter(r => r.category === category)
                    .reduce((sum, r) => sum + (r.dailyAllocations[dayIdx] || 0), 0)
            ),
            backgroundColor: MO_CATEGORY_COLORS[category].fill,
            borderRadius: 3,
            maxBarThickness: 46,
        }));

        const maxStack = Math.max(
            moKpis.totalPlanned,
            ...moKpis.dailyTotalsByDay.map(d => d.total),
            1
        );

        moHistogramChartInstance.current = new Chart(ctx, {
            type: 'bar',
            plugins: [capacityLinePlugin],
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (_event, elements) => {
                    if (elements.length > 0) {
                        const dsIdx = elements[0].datasetIndex;
                        const cat = MO_CATEGORY_ORDER[dsIdx];
                        if (cat) {
                            setSelectedMoCategory(prev => (prev === cat ? 'all' : cat));
                        }
                    }
                },
                onHover: (event, elements) => {
                    if (event.native?.target) {
                        (event.native.target as HTMLElement).style.cursor = elements.length > 0 ? 'pointer' : 'default';
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 12 },
                    },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#cbd5e1',
                        callbacks: {
                            footer: items => {
                                const daySum = items.reduce((a, b) => a + (b.parsed.y || 0), 0);
                                return `Total no dia: ${daySum} | Capacidade: ${moKpis.totalPlanned}`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        stacked: true,
                        ticks: { color: '#e2e8f0', font: { size: 11, weight: 'bold' } },
                        grid: { display: false },
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        suggestedMax: Math.ceil(maxStack * 1.18),
                        ticks: { color: '#94a3b8', font: { size: 11 }, precision: 0 },
                        grid: { color: 'rgba(148, 163, 184, 0.12)' },
                    },
                },
            },
        });

        return () => {
            if (moHistogramChartInstance.current) {
                moHistogramChartInstance.current.destroy();
            }
        };
    }, [activeTab, moWorkdays, moRoleRows, moKpis]);

    // --- MO CHART 2: Distribuição por Categoria (Rosca + Centro + Click) ---
    useEffect(() => {
        if (activeTab !== 'manpower') return;
        const canvas = moCategoryChartRef.current;
        if (!canvas) return;
        if (moCategoryChartInstance.current) {
            moCategoryChartInstance.current.destroy();
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { items, total } = moCategoryBreakdown;

        moCategoryChartInstance.current = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: items.map(i => i.category),
                datasets: [
                    {
                        data: total > 0 ? items.map(i => i.count) : [1],
                        backgroundColor: total > 0 ? items.map(i => i.color) : ['#1e293b'],
                        borderColor: '#0f172a',
                        borderWidth: 3,
                        hoverOffset: 6,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                onClick: (_event, elements) => {
                    if (total === 0) return;
                    if (elements.length > 0) {
                        const clicked = items[elements[0].index];
                        if (clicked) {
                            setSelectedMoCategory(prev => (prev === clicked.category ? 'all' : clicked.category));
                        }
                    }
                },
                onHover: (event, elements) => {
                    if (event.native?.target) {
                        (event.native.target as HTMLElement).style.cursor =
                            total > 0 && elements.length > 0 ? 'pointer' : 'default';
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: total > 0,
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#cbd5e1',
                        callbacks: {
                            label: ctxItem => {
                                const item = items[ctxItem.dataIndex];
                                if (!item) return '';
                                return `${item.category}: ${item.count} (${item.pct.toFixed(1)}%) — clique para filtrar`;
                            },
                        },
                    },
                },
            },
        });

        return () => {
            if (moCategoryChartInstance.current) {
                moCategoryChartInstance.current.destroy();
            }
        };
    }, [activeTab, moCategoryBreakdown]);

    // --- MO CHART 3: Planejado vs. Alocado por Cargo (Barras Horizontais Comparativas) ---
    useEffect(() => {
        if (activeTab !== 'manpower') return;
        const canvas = moRolesChartRef.current;
        if (!canvas) return;
        if (moRolesChartInstance.current) {
            moRolesChartInstance.current.destroy();
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const orderedRoles = [...moRoleRows].sort(
            (a, b) => Math.max(b.planned, b.peakAllocated) - Math.max(a.planned, a.peakAllocated)
        );
        const labels = orderedRoles.map(r => r.role);

        moRolesChartInstance.current = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Planejado',
                        data: orderedRoles.map(r => r.planned),
                        backgroundColor: orderedRoles.map(r =>
                            selectedMoRole !== 'all' && r.role === selectedMoRole ? '#0ea5e9' : '#38bdf8'
                        ),
                        borderRadius: 4,
                        barThickness: 12,
                    },
                    {
                        label: 'Alocado (Pico)',
                        data: orderedRoles.map(r => r.peakAllocated),
                        backgroundColor: orderedRoles.map(r =>
                            r.peakAllocated > r.planned ? '#f43f5e' : '#10b981'
                        ),
                        borderRadius: 4,
                        barThickness: 12,
                    },
                ],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                onClick: (_event, elements) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const clickedRole = orderedRoles[idx]?.role;
                        if (clickedRole) {
                            setSelectedMoRole(prev => (prev === clickedRole ? 'all' : clickedRole));
                        }
                    }
                },
                onHover: (event, elements) => {
                    if (event.native?.target) {
                        (event.native.target as HTMLElement).style.cursor = elements.length > 0 ? 'pointer' : 'default';
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 12 },
                    },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#cbd5e1',
                        callbacks: {
                            afterBody: items => {
                                const idx = items[0]?.dataIndex;
                                const r = idx !== undefined ? orderedRoles[idx] : undefined;
                                if (!r) return [];
                                const devLabel = r.deviation > 0 ? `+${r.deviation}` : `${r.deviation}`;
                                return [`Desvio: ${devLabel} | H-Dia: ${r.manDays}`, 'Clique para isolar este cargo'];
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: '#94a3b8', font: { size: 11 }, precision: 0 },
                        grid: { color: 'rgba(148, 163, 184, 0.12)' },
                    },
                    y: {
                        ticks: {
                            color: '#e2e8f0',
                            font: { size: 11, weight: 'bold' },
                            autoSkip: false,
                        },
                        grid: { display: false },
                    },
                },
            },
        });

        return () => {
            if (moRolesChartInstance.current) {
                moRolesChartInstance.current.destroy();
            }
        };
    }, [activeTab, moRoleRows, selectedMoRole]);

    // ============================================================================
    // 3. SYNCHRONIZED PDF EXPORT & PRINT HEADER SUMMARY
    // ============================================================================
    const scheduleFiltersSummary = useMemo(() => {
        const parts: string[] = [];
        parts.push(
            selectedWeek === 'all'
                ? 'Semana: Todo o Período'
                : `Semana: ${availableWeeks.find(w => w.value === selectedWeek)?.label || selectedWeek}`
        );
        parts.push(`Setor: ${selectedSector === 'all' ? 'Todos' : selectedSector}`);
        parts.push(`FA: ${selectedFa === 'all' ? 'Todas' : formatFaLabel(selectedFa)}`);
        parts.push(`Status: ${selectedStatus === 'all' ? 'Todos' : STATUS_LABELS[selectedStatus]}`);
        parts.push(`Meta: ${targetAdherence}%`);
        return parts.join('  |  ');
    }, [selectedWeek, availableWeeks, selectedSector, selectedFa, selectedStatus, targetAdherence]);

    const moFiltersSummary = useMemo(() => {
        const weekLabel = allMoWeeks.find(w => w.value === selectedMoWeek)?.label || selectedMoWeek || 'Não definida';
        const shiftLabel =
            selectedShift === 'all' ? 'Todos' : selectedShift === 'adm' ? 'Turno ADM' : '2º Turno';
        const catLabel = selectedMoCategory === 'all' ? 'Todas' : selectedMoCategory;
        const roleLabel = selectedMoRole === 'all' ? 'Todos' : selectedMoRole;
        return `Semana: ${weekLabel}  |  Turno: ${shiftLabel}  |  Categoria: ${catLabel}  |  Cargo: ${roleLabel}`;
    }, [allMoWeeks, selectedMoWeek, selectedShift, selectedMoCategory, selectedMoRole]);

    const handleExportPdf = () => {
        if (activeTab === 'schedule') {
            exportScheduleDashboardPdf({
                title,
                programmerName,
                filtersSummary: scheduleFiltersSummary,
                kpis: {
                    adherenceRate: `${kpis.adherenceRate.toFixed(1)}%`,
                    adherenceDelta: `${kpis.adherenceDelta >= 0 ? '+' : ''}${kpis.adherenceDelta.toFixed(1)}% vs Meta`,
                    targetAdherence,
                    totalCarteira: kpis.totalCarteira,
                    totalRealizado: kpis.totalRealizado,
                    totalNaoRealizado: kpis.totalNaoRealizado,
                    totalCancelado: kpis.totalCancelado,
                    totalProgramadoOpen: kpis.totalProgramadoOpen,
                },
                canvases: {
                    daily: dailyChartRef.current,
                    doughnut: doughnutChartRef.current,
                    sector: sectorChartRef.current,
                },
                faRows: faStats.map(f => ({
                    faLabel: f.faLabel,
                    sector: f.primarySector,
                    ok: f.ok,
                    active: f.active,
                    pending: f.pendingCount,
                    pct: `${f.pctCompleted.toFixed(1)}%`,
                })),
                actionRows: actionPlanRows.map(r => ({
                    dateBr: formatDateBr(r.dateStr),
                    faLabel: r.faLabel,
                    sector: r.sector,
                    taskTitle: r.taskTitle,
                    activityName: r.activityName,
                    statusLabel:
                        r.effectiveStatus === Status.NaoRealizado
                            ? r.wasPastProgramado
                                ? 'Não Realizada (X vencido)'
                                : 'Não Realizada (N)'
                            : 'Cancelada (C)',
                })),
            });
        } else {
            exportManpowerDashboardPdf({
                title,
                programmerName,
                filtersSummary: moFiltersSummary,
                kpis: {
                    allocatedVsPlanned: `${moKpis.totalAllocated} / ${moKpis.totalPlanned}`,
                    occupancyBadge: `${moKpis.occupancyPct.toFixed(1)}% ocupação`,
                    netDeviation: `${moKpis.netDeviation > 0 ? '+' : ''}${moKpis.netDeviation}`,
                    worstDeficitInfo: moKpis.worstDeficitRole
                        ? `Maior falta: ${moKpis.worstDeficitRole.role} (${moKpis.worstDeficitRole.deviation})`
                        : 'Sem déficit',
                    shift2Coverage: `${moKpis.shift2Total} prof.`,
                    shift2PctInfo: `${moKpis.shift2Pct.toFixed(1)}% do efetivo`,
                    peakDailyValue: `${moKpis.peakDailyValue} prof.`,
                    peakDailyInfo: `Dia: ${moKpis.peakDailyLabel}`,
                },
                canvases: {
                    histogram: moHistogramChartRef.current,
                    category: moCategoryChartRef.current,
                    roles: moRolesChartRef.current,
                },
                tableRows: moRoleRows.map(r => ({
                    role: r.role,
                    category: r.category,
                    planned: r.planned,
                    allocated: r.peakAllocated,
                    manDays: r.manDays,
                    deviationLabel: r.deviation > 0 ? `+${r.deviation}` : `${r.deviation}`,
                    statusLabel:
                        r.deviation < 0 ? 'Déficit' : r.deviation > 0 ? 'Superávit' : 'Equilibrado',
                })),
            });
        }
    };

    const todayStr = useMemo(() => formatDate(new Date()), []);
    const sectorChartHeight = Math.max(250, sectorStats.length * 34);
    const moRolesChartHeight = Math.max(260, moRoleRows.length * 38);
    const nowEmission = new Date();

    return (
        <div className="dashboard-view dashboard-print-root !p-0 bg-slate-950 text-slate-100">
            {/* Cabeçalho exclusivo visível somente na impressão (@media print) */}
            <div className="print-only hidden border-b-2 border-slate-900 pb-3 mb-4 px-5 pt-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 m-0">
                            {activeTab === 'schedule'
                                ? 'Relatório Gerencial — Programação & Aderência'
                                : 'Relatório Gerencial — Mão de Obra (MO)'}
                        </h1>
                        <p className="text-xs text-slate-700 m-0 mt-1">
                            Projeto: <strong>{title}</strong> | Responsável:{' '}
                            <strong>{programmerName || 'Não informado'}</strong>
                        </p>
                    </div>
                    <div className="text-right text-xs text-slate-700 tabular-nums">
                        Emitido em: {nowEmission.toLocaleDateString('pt-BR')} às{' '}
                        {nowEmission.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                </div>
                <div className="mt-2 px-3 py-1.5 bg-slate-100 border border-slate-300 rounded text-[11px] text-slate-800">
                    <strong>Filtros aplicados:</strong>{' '}
                    {activeTab === 'schedule' ? scheduleFiltersSummary : moFiltersSummary}
                </div>
            </div>

            {/* 1. Barra Fixa Superior: Seletor de Dashboard + Ações + Filtros */}
            <div className="no-print sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                        {/* Seletor entre Programação & Aderência e Mão de Obra (MO) */}
                        <div className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-800">
                            <button
                                type="button"
                                onClick={() => setActiveTab('schedule')}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors border-0 ${
                                    activeTab === 'schedule'
                                        ? 'bg-sky-600 text-white shadow-sm'
                                        : 'bg-transparent text-slate-400 hover:text-slate-100'
                                }`}
                            >
                                <span className="material-icons text-[16px]">analytics</span>
                                Programação & Aderência
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('manpower')}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors border-0 ${
                                    activeTab === 'manpower'
                                        ? 'bg-sky-600 text-white shadow-sm'
                                        : 'bg-transparent text-slate-400 hover:text-slate-100'
                                }`}
                            >
                                <span className="material-icons text-[16px]">groups</span>
                                Mão de Obra (MO)
                            </button>
                        </div>

                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-base font-semibold text-white m-0 tracking-tight">
                                    {activeTab === 'schedule'
                                        ? 'Dashboard Gerencial de Programação'
                                        : 'Dashboard Gerencial de Mão de Obra (MO)'}
                                </h2>
                                <span className="text-xs font-medium text-slate-400 tabular-nums">
                                    {activeTab === 'schedule'
                                        ? `${filteredOccurrences.length} de ${occurrences.length} registros`
                                        : `${moRoleRows.length} cargos exibidos`}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0">
                                {activeTab === 'schedule'
                                    ? 'Clique em barras de Setor, fatias de Status ou linhas de FA para filtro cruzado.'
                                    : 'Clique em categorias no Histograma/Rosca ou em cargos nas barras para filtro cruzado.'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {((activeTab === 'schedule' && hasScheduleActiveFilters) ||
                            (activeTab === 'manpower' && hasMoActiveFilters)) && (
                            <button
                                type="button"
                                onClick={activeTab === 'schedule' ? clearScheduleFilters : clearMoFilters}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 text-xs font-semibold cursor-pointer transition-colors"
                            >
                                <span className="material-icons text-[15px]">filter_alt_off</span>
                                Limpar Filtros
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer transition-colors"
                            title="Imprimir visão atual"
                        >
                            <span className="material-icons text-[16px]">print</span>
                            Imprimir
                        </button>
                        <button
                            type="button"
                            onClick={handleExportPdf}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white border border-sky-500 text-xs font-semibold cursor-pointer transition-colors"
                        >
                            <span className="material-icons text-[16px]">picture_as_pdf</span>
                            Exportar PDF
                        </button>
                    </div>
                </div>

                {/* Filtros da Visão Programação & Aderência */}
                {activeTab === 'schedule' && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="dash-week"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Semana
                                </label>
                                <select
                                    id="dash-week"
                                    value={selectedWeek}
                                    onChange={e => setSelectedWeek(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="all">Todo o Período</option>
                                    {availableWeeks.map(w => (
                                        <option key={w.value} value={w.value}>
                                            {w.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="dash-sector"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Setor
                                </label>
                                <select
                                    id="dash-sector"
                                    value={selectedSector}
                                    onChange={e => setSelectedSector(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="all">Todos os Setores</option>
                                    {availableSectors.map(sec => (
                                        <option key={sec} value={sec}>
                                            {sec}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="dash-fa"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Folha de Acompanhamento (FA)
                                </label>
                                <select
                                    id="dash-fa"
                                    value={selectedFa}
                                    onChange={e => setSelectedFa(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="all">Todas as FAs</option>
                                    {availableFas.map(fa => (
                                        <option key={fa.value} value={fa.value}>
                                            {fa.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="dash-status"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Status
                                </label>
                                <select
                                    id="dash-status"
                                    value={selectedStatus}
                                    onChange={e => setSelectedStatus(e.target.value as Status | 'all')}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="all">Todos os Status</option>
                                    <option value={Status.Realizado}>Realizado (OK)</option>
                                    <option value={Status.NaoRealizado}>Não Realizado (N)</option>
                                    <option value={Status.Cancelado}>Cancelado (C)</option>
                                    <option value={Status.Programado}>Programado (X)</option>
                                </select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="dash-meta"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Meta de Aderência (%)
                                </label>
                                <div className="relative flex items-center">
                                    <input
                                        id="dash-meta"
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={targetAdherence}
                                        onChange={e => {
                                            const val = Number(e.target.value);
                                            if (!isNaN(val)) {
                                                setTargetAdherence(Math.max(0, Math.min(100, val)));
                                            }
                                        }}
                                        className="w-full px-2.5 py-1.5 pr-7 rounded-lg bg-slate-900 border border-slate-700 text-sky-400 font-semibold tabular-nums text-xs focus:outline-none focus:border-sky-500"
                                    />
                                    <span className="absolute right-2.5 text-xs text-slate-400 pointer-events-none">%</span>
                                </div>
                            </div>
                        </div>

                        {hasScheduleActiveFilters && (
                            <div className="flex flex-wrap items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-800/80">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1">
                                    <span className="material-icons text-[14px]">filter_list</span>
                                    Filtros ativos:
                                </span>
                                {selectedWeek !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedWeek('all')}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs cursor-pointer hover:bg-sky-500/25"
                                    >
                                        {availableWeeks.find(w => w.value === selectedWeek)?.label || selectedWeek}
                                        <span className="material-icons text-[13px]">close</span>
                                    </button>
                                )}
                                {selectedSector !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedSector('all')}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs cursor-pointer hover:bg-sky-500/25"
                                    >
                                        Setor: {selectedSector}
                                        <span className="material-icons text-[13px]">close</span>
                                    </button>
                                )}
                                {selectedFa !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedFa('all')}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs cursor-pointer hover:bg-sky-500/25"
                                    >
                                        {formatFaLabel(selectedFa)}
                                        <span className="material-icons text-[13px]">close</span>
                                    </button>
                                )}
                                {selectedStatus !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedStatus('all')}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs cursor-pointer hover:bg-sky-500/25"
                                    >
                                        Status: {STATUS_LABELS[selectedStatus]}
                                        <span className="material-icons text-[13px]">close</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* Filtros da Visão Mão de Obra (MO) */}
                {activeTab === 'manpower' && (
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="mo-week"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Semana de Referência
                                </label>
                                <select
                                    id="mo-week"
                                    value={selectedMoWeek}
                                    onChange={e => setSelectedMoWeek(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    {allMoWeeks.map(w => (
                                        <option key={w.value} value={w.value}>
                                            {w.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="mo-shift"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Turno
                                </label>
                                <select
                                    id="mo-shift"
                                    value={selectedShift}
                                    onChange={e => setSelectedShift(e.target.value as MoShiftFilter)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="all">Todos</option>
                                    <option value="adm">Turno ADM</option>
                                    <option value="shift2">2º Turno</option>
                                </select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="mo-category"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Categoria
                                </label>
                                <select
                                    id="mo-category"
                                    value={selectedMoCategory}
                                    onChange={e => setSelectedMoCategory(e.target.value as MoCategory | 'all')}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="all">Todas</option>
                                    <option value="Supervisão">Supervisão</option>
                                    <option value="Ofícios">Ofícios</option>
                                    <option value="Inspeção">Inspeção</option>
                                    <option value="Outros">Outros</option>
                                </select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label
                                    htmlFor="mo-role"
                                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                                >
                                    Cargo
                                </label>
                                <select
                                    id="mo-role"
                                    value={selectedMoRole}
                                    onChange={e => setSelectedMoRole(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="all">Todos os Cargos</option>
                                    {moRolesList.map(r => (
                                        <option key={r} value={r}>
                                            {r}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {hasMoActiveFilters && (
                            <div className="flex flex-wrap items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-800/80">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1">
                                    <span className="material-icons text-[14px]">filter_list</span>
                                    Filtros ativos:
                                </span>
                                {selectedShift !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedShift('all')}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs cursor-pointer hover:bg-sky-500/25"
                                    >
                                        Turno: {selectedShift === 'adm' ? 'Turno ADM' : '2º Turno'}
                                        <span className="material-icons text-[13px]">close</span>
                                    </button>
                                )}
                                {selectedMoCategory !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedMoCategory('all')}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs cursor-pointer hover:bg-sky-500/25"
                                    >
                                        Categoria: {selectedMoCategory}
                                        <span className="material-icons text-[13px]">close</span>
                                    </button>
                                )}
                                {selectedMoRole !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedMoRole('all')}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs cursor-pointer hover:bg-sky-500/25"
                                    >
                                        Cargo: {selectedMoRole}
                                        <span className="material-icons text-[13px]">close</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ================================================================ */}
            {/* CORPO DA VISÃO: PROGRAMAÇÃO & ADERÊNCIA                         */}
            {/* ================================================================ */}
            {activeTab === 'schedule' && (
                <div className="p-5 flex flex-col gap-5">
                    {/* 2. Cards de KPIs Gerenciais */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Aderência Efetiva (%)
                                </span>
                                <span
                                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                                        kpis.adherenceDelta >= 0
                                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                    }`}
                                >
                                    {kpis.adherenceDelta >= 0 ? '+' : ''}
                                    {kpis.adherenceDelta.toFixed(1)}% vs Meta
                                </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                                <span
                                    className={`text-3xl font-bold tabular-nums tracking-tight ${
                                        kpis.adherenceDelta >= 0 ? 'text-emerald-400' : 'text-amber-400'
                                    }`}
                                >
                                    {kpis.adherenceRate.toFixed(1)}%
                                </span>
                                <span className="text-xs text-slate-400 tabular-nums">Meta: {targetAdherence}%</span>
                            </div>
                            <p className="text-xs text-slate-400 m-0 tabular-nums">
                                {kpis.totalRealizado} OK de {kpis.totalAtivas} ativas (exclui C)
                            </p>
                        </div>

                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Carteira Programada
                                </span>
                                <span className="material-icons text-[18px] text-sky-400">inventory_2</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-3xl font-bold text-white tabular-nums tracking-tight">
                                    {kpis.totalCarteira}
                                </span>
                                <span className="text-xs text-sky-400 font-medium tabular-nums">
                                    {kpis.pctAtivasCarteira.toFixed(0)}% ativas
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0 tabular-nums truncate">
                                {kpis.totalProgramadoOpen} em aberto (X) · {kpis.uniqueFaCount} FAs
                            </p>
                        </div>

                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Executadas (OK)
                                </span>
                                <span className="material-icons text-[18px] text-emerald-400">task_alt</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-3xl font-bold text-emerald-400 tabular-nums tracking-tight">
                                    {kpis.totalRealizado}
                                </span>
                                <span className="text-xs text-emerald-400/90 font-medium tabular-nums">
                                    {kpis.pctRealizadoCarteira.toFixed(1)}% da carteira
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0 tabular-nums truncate">
                                {kpis.totalAtivas > 0
                                    ? `${((kpis.totalRealizado / kpis.totalAtivas) * 100).toFixed(1)}% das ativas`
                                    : 'Sem atividades ativas'}
                            </p>
                        </div>

                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Não Realizadas (N)
                                </span>
                                <span className="material-icons text-[18px] text-rose-400">warning_amber</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-3xl font-bold text-rose-400 tabular-nums tracking-tight">
                                    {kpis.totalNaoRealizado}
                                </span>
                                <span className="text-xs text-rose-400/90 font-medium tabular-nums">
                                    {kpis.pctNaoRealizadoCarteira.toFixed(1)}% da carteira
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0 truncate">
                                {kpis.topFailEntry
                                    ? `Maior gargalo: ${kpis.topFailEntry[0]} (${kpis.topFailEntry[1]})`
                                    : 'Sem pendências críticas'}
                            </p>
                        </div>

                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Canceladas (C)
                                </span>
                                <span className="material-icons text-[18px] text-slate-400">cancel</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-3xl font-bold text-slate-200 tabular-nums tracking-tight">
                                    {kpis.totalCancelado}
                                </span>
                                <span className="text-xs text-slate-400 font-medium tabular-nums">
                                    {kpis.pctCanceladoCarteira.toFixed(1)}% da carteira
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0 truncate">
                                {kpis.topCancelEntry
                                    ? `Maior concentração: ${kpis.topCancelEntry[0]} (${kpis.topCancelEntry[1]})`
                                    : 'Sem cancelamentos no filtro'}
                            </p>
                        </div>
                    </div>

                    {/* 3. Grade de Gráficos Interativos */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                        <div className="dashboard-print-card lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-white m-0">
                                        Atingimento Diário da Programação
                                    </h3>
                                    <p className="text-xs text-slate-400 m-0">
                                        {dailyChartMode === 'daily'
                                            ? `Percentual diário realizado vs Meta (${targetAdherence}%)`
                                            : `Evolução acumulada da execução vs Previsto e Meta (${targetAdherence}%)`}
                                    </p>
                                </div>
                                <div className="no-print inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => setDailyChartMode('daily')}
                                        className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors border-0 ${
                                            dailyChartMode === 'daily'
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-transparent text-slate-400 hover:text-slate-200'
                                        }`}
                                    >
                                        Diário
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDailyChartMode('curveS')}
                                        className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors border-0 ${
                                            dailyChartMode === 'curveS'
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-transparent text-slate-400 hover:text-slate-200'
                                        }`}
                                    >
                                        Curva S (% Acumulada)
                                    </button>
                                </div>
                            </div>
                            <div className="relative h-72 w-full">
                                {dailySeries.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-xs text-slate-500">
                                        Sem dados para o período e filtros selecionados.
                                    </div>
                                ) : (
                                    <canvas ref={dailyChartRef} />
                                )}
                            </div>
                        </div>

                        <div className="dashboard-print-card lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-white m-0">Distribuição do Status</h3>
                                    <p className="text-xs text-slate-400 m-0">
                                        Clique em uma fatia ou item para filtrar
                                    </p>
                                </div>
                                {selectedStatus !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedStatus('all')}
                                        className="no-print text-[11px] font-semibold text-sky-400 hover:text-sky-300 bg-transparent border-0 cursor-pointer"
                                    >
                                        Ver todos
                                    </button>
                                )}
                            </div>

                            <div className="relative h-52 w-full flex items-center justify-center">
                                <canvas ref={doughnutChartRef} />
                                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                                    <span className="text-2xl font-bold text-white tabular-nums leading-none">
                                        {kpis.adherenceRate.toFixed(1)}%
                                    </span>
                                    <span className="text-[11px] font-medium text-slate-400 mt-1">
                                        Aderência Efetiva
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                                {doughnutItems.slice(0, 3).map(item => {
                                    const pct =
                                        kpis.totalCarteira > 0
                                            ? ((item.count / kpis.totalCarteira) * 100).toFixed(1)
                                            : '0.0';
                                    const isActive = selectedStatus === item.status;
                                    return (
                                        <button
                                            key={item.status}
                                            type="button"
                                            onClick={() =>
                                                setSelectedStatus(prev =>
                                                    prev === item.status ? 'all' : item.status
                                                )
                                            }
                                            className={`flex flex-col items-start p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                                                isActive
                                                    ? 'bg-sky-500/15 border-sky-500/40'
                                                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5 w-full">
                                                <span
                                                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_CHART_COLORS[item.status].dot}`}
                                                />
                                                <span className="text-[11px] font-medium text-slate-300 truncate">
                                                    {item.label}
                                                </span>
                                            </div>
                                            <div className="flex items-baseline gap-1.5 mt-1 tabular-nums">
                                                <span className="text-sm font-bold text-white">{item.count}</span>
                                                <span className="text-[11px] text-slate-400">({pct}%)</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            {kpis.totalProgramadoOpen > 0 && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setSelectedStatus(prev =>
                                            prev === Status.Programado ? 'all' : Status.Programado
                                        )
                                    }
                                    className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                                        selectedStatus === Status.Programado
                                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                            : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                                    }`}
                                >
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                                        Programado em aberto (X)
                                    </span>
                                    <span className="font-bold tabular-nums">{kpis.totalProgramadoOpen}</span>
                                </button>
                            )}
                        </div>

                        <div className="dashboard-print-card lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-white m-0">
                                        Aderência e Atingimento por Setor
                                    </h3>
                                    <p className="text-xs text-slate-400 m-0">
                                        {sectorChartMode === 'ranking'
                                            ? 'Ordenado do pior para o melhor setor (gargalos no topo). Clique para filtrar.'
                                            : 'Distribuição de volume por status em cada setor. Clique para filtrar.'}
                                    </p>
                                </div>
                                <div className="no-print inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => setSectorChartMode('ranking')}
                                        className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors border-0 ${
                                            sectorChartMode === 'ranking'
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-transparent text-slate-400 hover:text-slate-200'
                                        }`}
                                    >
                                        % Aderência (Ranking)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSectorChartMode('volume')}
                                        className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors border-0 ${
                                            sectorChartMode === 'volume'
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-transparent text-slate-400 hover:text-slate-200'
                                        }`}
                                    >
                                        Volume (Empilhado)
                                    </button>
                                </div>
                            </div>
                            <div className="overflow-y-auto max-h-96 pr-1">
                                {sectorStats.length === 0 ? (
                                    <div className="h-60 flex items-center justify-center text-xs text-slate-500">
                                        Nenhum setor encontrado com os filtros atuais.
                                    </div>
                                ) : (
                                    <div style={{ height: `${sectorChartHeight}px`, minHeight: '240px', width: '100%' }}>
                                        <canvas ref={sectorChartRef} />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="dashboard-print-card lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-white m-0">
                                        Atingimento por Folha de Acompanhamento (FA)
                                    </h3>
                                    <p className="text-xs text-slate-400 m-0">
                                        Clique em qualquer FA para aplicar filtro cruzado.
                                    </p>
                                </div>
                                <select
                                    aria-label="Ordenação das FAs"
                                    value={faSortMode}
                                    onChange={e =>
                                        setFaSortMode(e.target.value as 'pending' | 'lowestPct' | 'highestPct')
                                    }
                                    className="no-print px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="pending">Maior Pendência</option>
                                    <option value="lowestPct">Menor % Atingido</option>
                                    <option value="highestPct">Maior % Atingido</option>
                                </select>
                            </div>

                            <div className="flex flex-col gap-2 overflow-y-auto max-h-96 pr-1">
                                {faStats.length === 0 ? (
                                    <div className="h-60 flex items-center justify-center text-xs text-slate-500">
                                        Nenhuma FA encontrada para os filtros atuais.
                                    </div>
                                ) : (
                                    faStats.map(fa => {
                                        const isSelected = selectedFa === fa.faKey;
                                        const secStyle = getSectorStyle(fa.primarySector);
                                        const barColor =
                                            fa.pctCompleted >= targetAdherence
                                                ? 'bg-emerald-500'
                                                : fa.pctCompleted >= targetAdherence - 20
                                                  ? 'bg-amber-500'
                                                  : 'bg-rose-500';
                                        return (
                                            <button
                                                key={fa.faKey}
                                                type="button"
                                                onClick={() =>
                                                    setSelectedFa(prev => (prev === fa.faKey ? 'all' : fa.faKey))
                                                }
                                                className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-sky-500/15 border-sky-500/50'
                                                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="text-xs font-semibold text-white truncate">
                                                            {fa.faLabel}
                                                        </span>
                                                        <span
                                                            className="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0"
                                                            style={{
                                                                backgroundColor: secStyle.background,
                                                                color: secStyle.color,
                                                            }}
                                                        >
                                                            {fa.primarySector}
                                                            {fa.extraSectors > 0 ? ` +${fa.extraSectors}` : ''}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
                                                        <span className="text-[11px] text-slate-400">
                                                            {fa.ok}/{fa.active} ({fa.pendingCount} pend.)
                                                        </span>
                                                        <span
                                                            className={`text-xs font-bold ${
                                                                fa.pctCompleted >= targetAdherence
                                                                    ? 'text-emerald-400'
                                                                    : fa.pctCompleted >= targetAdherence - 20
                                                                      ? 'text-amber-400'
                                                                      : 'text-rose-400'
                                                            }`}
                                                        >
                                                            {fa.pctCompleted.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${barColor}`}
                                                        style={{ width: `${Math.min(100, fa.pctCompleted)}%` }}
                                                    />
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 4. Tabela Gerencial de Plano de Ação */}
                    <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-white m-0 flex items-center gap-2">
                                    <span className="material-icons text-[18px] text-rose-400">assignment_late</span>
                                    Plano de Ação — Gargalos Críticos (N e C)
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-200 tabular-nums">
                                        {actionPlanRows.length}
                                    </span>
                                </h3>
                                <p className="text-xs text-slate-400 m-0 mt-0.5">
                                    Atividades Não Realizadas (N) ou Canceladas (C) nos filtros ativos com ações diretas no cronograma.
                                </p>
                            </div>

                            <div className="no-print flex flex-wrap items-center gap-2">
                                <div className="relative">
                                    <span className="material-icons text-[15px] text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                                        search
                                    </span>
                                    <input
                                        type="text"
                                        value={actionSearch}
                                        onChange={e => setActionSearch(e.target.value)}
                                        placeholder="Buscar tarefa, atividade, FA..."
                                        className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-56"
                                    />
                                </div>
                                <select
                                    aria-label="Filtrar status na tabela de plano de ação"
                                    value={actionFilterStatus}
                                    onChange={e =>
                                        setActionFilterStatus(
                                            e.target.value as 'all' | Status.NaoRealizado | Status.Cancelado
                                        )
                                    }
                                    className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                    <option value="all">Todas (N + C)</option>
                                    <option value={Status.NaoRealizado}>Somente Não Realizadas (N)</option>
                                    <option value={Status.Cancelado}>Somente Canceladas (C)</option>
                                </select>
                            </div>
                        </div>

                        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead className="sticky top-0 z-10 bg-slate-950 text-slate-400 uppercase text-[11px] tracking-wider border-b border-slate-800">
                                    <tr>
                                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Data / Semana</th>
                                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">FA</th>
                                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Setor</th>
                                        <th className="py-2.5 px-3 font-semibold">Tarefa Principal</th>
                                        <th className="py-2.5 px-3 font-semibold">Atividade</th>
                                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Status</th>
                                        <th className="no-print py-2.5 px-3 font-semibold text-right whitespace-nowrap">
                                            Ações Rápidas
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/80">
                                    {actionPlanRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="py-8 text-center text-slate-400">
                                                Nenhuma atividade Não Realizada (N) ou Cancelada (C) para os filtros selecionados.
                                            </td>
                                        </tr>
                                    ) : (
                                        actionPlanRows.map(row => {
                                            const secStyle = getSectorStyle(row.sector);
                                            const isRescheduling = reschedulingRowId === row.id;
                                            const nextPlannedDate = futureScheduledMap.get(row.activityId);
                                            const hasRecoveryPlanned =
                                                nextPlannedDate && nextPlannedDate > row.dateStr;

                                            return (
                                                <tr
                                                    key={row.id}
                                                    className="hover:bg-slate-800/50 transition-colors"
                                                >
                                                    <td className="py-2 px-3 whitespace-nowrap tabular-nums">
                                                        <div className="font-semibold text-slate-200">
                                                            {formatDateBr(row.dateStr)}
                                                        </div>
                                                        <div className="text-[11px] text-slate-500">
                                                            Sem. {row.weekNum.toString().padStart(2, '0')}
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-3 whitespace-nowrap font-semibold text-sky-300">
                                                        {row.faLabel}
                                                    </td>
                                                    <td className="py-2 px-3 whitespace-nowrap">
                                                        <span
                                                            className="px-2 py-0.5 rounded text-[11px] font-bold inline-block"
                                                            style={{
                                                                backgroundColor: secStyle.background,
                                                                color: secStyle.color,
                                                            }}
                                                        >
                                                            {row.sector}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-200 max-w-[220px]">
                                                        <div className="truncate font-medium" title={row.taskTitle}>
                                                            {row.taskTitle}
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-300 max-w-[260px]">
                                                        <div className="truncate" title={row.activityName}>
                                                            {row.activityName}
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-3 whitespace-nowrap">
                                                        <div className="flex flex-col items-start gap-1">
                                                            <span
                                                                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                                                    row.effectiveStatus === Status.NaoRealizado
                                                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                                                        : 'bg-slate-700/60 text-slate-300 border border-slate-600'
                                                                }`}
                                                            >
                                                                {row.effectiveStatus === Status.NaoRealizado
                                                                    ? row.wasPastProgramado
                                                                        ? 'Não Realizada (X vencido)'
                                                                        : 'Não Realizada (N)'
                                                                    : 'Cancelada (C)'}
                                                            </span>
                                                            {hasRecoveryPlanned && (
                                                                <span className="text-[10px] text-amber-400 font-medium tabular-nums">
                                                                    Reprog. → {formatDateBr(nextPlannedDate)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="no-print py-2 px-3 whitespace-nowrap text-right">
                                                        {isRescheduling ? (
                                                            <div className="inline-flex items-center gap-1.5 justify-end">
                                                                <input
                                                                    type="date"
                                                                    value={rescheduleTargetDate}
                                                                    onChange={e => setRescheduleTargetDate(e.target.value)}
                                                                    className="px-2 py-1 rounded bg-slate-950 border border-sky-500 text-slate-100 text-xs tabular-nums focus:outline-none"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (onRescheduleActivity && rescheduleTargetDate) {
                                                                            onRescheduleActivity(
                                                                                row.activityId,
                                                                                row.dateStr,
                                                                                rescheduleTargetDate
                                                                            );
                                                                        }
                                                                        setReschedulingRowId(null);
                                                                    }}
                                                                    title="Confirmar reprogramação"
                                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold border-0 cursor-pointer"
                                                                >
                                                                    <span className="material-icons text-[14px]">check</span>
                                                                    OK
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setReschedulingRowId(null)}
                                                                    title="Cancelar"
                                                                    className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border-0 cursor-pointer"
                                                                >
                                                                    <span className="material-icons text-[14px]">close</span>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="inline-flex items-center gap-1.5 justify-end">
                                                                <button
                                                                    type="button"
                                                                    disabled={!onRescheduleActivity}
                                                                    onClick={() => {
                                                                        const baseDate =
                                                                            todayStr >= row.dateStr ? todayStr : row.dateStr;
                                                                        setRescheduleTargetDate(getNextWorkingDay(baseDate));
                                                                        setReschedulingRowId(row.id);
                                                                    }}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold cursor-pointer disabled:opacity-40 transition-colors"
                                                                >
                                                                    <span className="material-icons text-[14px]">
                                                                        event_repeat
                                                                    </span>
                                                                    Reprogramar
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={!onMarkActivityDone}
                                                                    onClick={() =>
                                                                        onMarkActivityDone?.(row.activityId, row.dateStr)
                                                                    }
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-semibold cursor-pointer disabled:opacity-40 transition-colors"
                                                                >
                                                                    <span className="material-icons text-[14px]">
                                                                        check_circle
                                                                    </span>
                                                                    Concluir OK
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ================================================================ */}
            {/* CORPO DA VISÃO: MÃO DE OBRA (MO)                                 */}
            {/* ================================================================ */}
            {activeTab === 'manpower' && (
                <div className="p-5 flex flex-col gap-5">
                    {/* 4 Cards de KPIs Gerenciais de MO */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                        {/* 1. Efetivo Alocado vs. Planejado */}
                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Alocado vs. Planejado
                                </span>
                                <span
                                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                                        moKpis.occupancyPct > 100
                                            ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                            : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    }`}
                                >
                                    {moKpis.occupancyPct.toFixed(1)}% ocupação
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2 tabular-nums">
                                <span className="text-3xl font-bold text-white tracking-tight">
                                    {moKpis.totalAllocated}
                                </span>
                                <span className="text-base font-semibold text-slate-400">
                                    / {moKpis.totalPlanned}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0 tabular-nums">
                                Pico semanal alocado frente à capacidade planejada
                            </p>
                        </div>

                        {/* 2. Déficit / Superávit de Efetivo */}
                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Déficit / Superávit
                                </span>
                                <span
                                    className={`material-icons text-[18px] ${
                                        moKpis.netDeviation < 0 ? 'text-rose-400' : 'text-emerald-400'
                                    }`}
                                >
                                    {moKpis.netDeviation < 0 ? 'trending_down' : 'balance'}
                                </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                                <span
                                    className={`text-3xl font-bold tabular-nums tracking-tight ${
                                        moKpis.netDeviation < 0
                                            ? 'text-rose-400'
                                            : moKpis.netDeviation > 0
                                              ? 'text-emerald-400'
                                              : 'text-slate-100'
                                    }`}
                                >
                                    {moKpis.netDeviation > 0 ? `+${moKpis.netDeviation}` : moKpis.netDeviation}
                                </span>
                                <span className="text-xs text-slate-400">
                                    {moKpis.netDeviation < 0
                                        ? 'Déficit líquido'
                                        : moKpis.netDeviation > 0
                                          ? 'Superávit disponível'
                                          : 'Equilibrado'}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0 truncate">
                                {moKpis.worstDeficitRole
                                    ? `Maior falta: ${moKpis.worstDeficitRole.role} (${moKpis.worstDeficitRole.deviation})`
                                    : 'Sem déficit nos cargos filtrados'}
                            </p>
                        </div>

                        {/* 3. Cobertura 2º Turno */}
                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Cobertura 2º Turno
                                </span>
                                <span className="material-icons text-[18px] text-amber-400">nights_stay</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2 tabular-nums">
                                <span className="text-3xl font-bold text-amber-400 tracking-tight">
                                    {moKpis.shift2Total}
                                </span>
                                <span className="text-xs text-amber-300 font-medium">
                                    {moKpis.shift2Pct.toFixed(1)}% do efetivo
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0">
                                {project.manpowerAllocation.hasSecondShift
                                    ? '2º Turno habilitado na semana selecionada'
                                    : '2º Turno desabilitado no projeto'}
                            </p>
                        </div>

                        {/* 4. Pico Diário no Histograma */}
                        <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Pico Diário no Histograma
                                </span>
                                <span className="material-icons text-[18px] text-sky-400">stacked_bar_chart</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2 tabular-nums">
                                <span className="text-3xl font-bold text-sky-400 tracking-tight">
                                    {moKpis.peakDailyValue}
                                </span>
                                <span className="text-xs text-slate-300 font-medium">
                                    Cap.: {moKpis.totalPlanned}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 m-0 truncate">
                                Dia de maior demanda: {moKpis.peakDailyLabel}
                            </p>
                        </div>
                    </div>

                    {/* 3 Gráficos Interativos de MO */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                        {/* Gráfico 1: Histograma Diário Seg-Sex */}
                        <div className="dashboard-print-card lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-white m-0">
                                    Histograma Diário de Mão de Obra (Seg a Sex)
                                </h3>
                                <p className="text-xs text-slate-400 m-0">
                                    Demanda diária empilhada por categoria vs. Capacidade Planejada (linha tracejada). Clique para filtrar categoria.
                                </p>
                            </div>
                            <div className="relative h-72 w-full">
                                {moWorkdays.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-xs text-slate-500">
                                        Selecione uma semana válida para visualizar o histograma diário.
                                    </div>
                                ) : (
                                    <canvas ref={moHistogramChartRef} />
                                )}
                            </div>
                        </div>

                        {/* Gráfico 2: Distribuição por Categoria (Rosca + Centro + Legenda) */}
                        <div className="dashboard-print-card lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-white m-0">
                                        Distribuição por Categoria
                                    </h3>
                                    <p className="text-xs text-slate-400 m-0">
                                        {moCategoryBreakdown.useAllocatedBase
                                            ? 'Base: Efetivo alocado (clique na fatia para filtrar)'
                                            : 'Base: Efetivo planejado (clique na fatia para filtrar)'}
                                    </p>
                                </div>
                                {selectedMoCategory !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedMoCategory('all')}
                                        className="no-print text-[11px] font-semibold text-sky-400 hover:text-sky-300 bg-transparent border-0 cursor-pointer"
                                    >
                                        Todas
                                    </button>
                                )}
                            </div>

                            <div className="relative h-52 w-full flex items-center justify-center">
                                <canvas ref={moCategoryChartRef} />
                                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                                    <span className="text-2xl font-bold text-white tabular-nums leading-none">
                                        {moCategoryBreakdown.total}
                                    </span>
                                    <span className="text-[11px] font-medium text-slate-400 mt-1">
                                        Profissionais
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800">
                                {moCategoryBreakdown.items.map(item => {
                                    const isActive = selectedMoCategory === item.category;
                                    return (
                                        <button
                                            key={item.category}
                                            type="button"
                                            onClick={() =>
                                                setSelectedMoCategory(prev =>
                                                    prev === item.category ? 'all' : item.category
                                                )
                                            }
                                            className={`flex flex-col items-start p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                                                isActive
                                                    ? 'bg-sky-500/15 border-sky-500/40'
                                                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5 w-full">
                                                <span
                                                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${MO_CATEGORY_COLORS[item.category].dot}`}
                                                />
                                                <span className="text-[11px] font-medium text-slate-300 truncate">
                                                    {item.category}
                                                </span>
                                            </div>
                                            <div className="flex items-baseline gap-1 mt-1 tabular-nums">
                                                <span className="text-sm font-bold text-white">{item.count}</span>
                                                <span className="text-[10px] text-slate-400">
                                                    ({item.pct.toFixed(0)}%)
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Gráfico 3: Planejado vs Alocado por Cargo */}
                        <div className="dashboard-print-card lg:col-span-12 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-white m-0">
                                        Planejado vs. Alocado por Cargo
                                    </h3>
                                    <p className="text-xs text-slate-400 m-0">
                                        Comparativo entre efetivo planejado e pico de alocação semanal. Clique em qualquer barra para isolar o cargo.
                                    </p>
                                </div>
                                {selectedMoRole !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedMoRole('all')}
                                        className="no-print text-xs font-semibold text-sky-400 hover:text-sky-300 bg-transparent border-0 cursor-pointer"
                                    >
                                        Mostrar todos os cargos
                                    </button>
                                )}
                            </div>
                            <div className="overflow-y-auto max-h-96 pr-1">
                                {moRoleRows.length === 0 ? (
                                    <div className="h-60 flex items-center justify-center text-xs text-slate-500">
                                        Nenhum cargo encontrado com os filtros atuais.
                                    </div>
                                ) : (
                                    <div style={{ height: `${moRolesChartHeight}px`, minHeight: '240px', width: '100%' }}>
                                        <canvas ref={moRolesChartRef} />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Tabela "Balanceamento & Desvios de Efetivo" */}
                    <div className="dashboard-print-card bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h3 className="text-sm font-semibold text-white m-0 flex items-center gap-2">
                                    <span className="material-icons text-[18px] text-sky-400">tune</span>
                                    Balanceamento & Desvios de Efetivo
                                </h3>
                                <p className="text-xs text-slate-400 m-0 mt-0.5">
                                    Ajuste o efetivo planejado diretamente com os botões{' '}
                                    <strong className="text-slate-200">- / +</strong> (editando{' '}
                                    <strong className="text-sky-300">
                                        {selectedShift === 'shift2' ? '2º Turno' : 'Turno ADM'}
                                    </strong>{' '}
                                    da semana selecionada).
                                </p>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead className="bg-slate-950 text-slate-400 uppercase text-[11px] tracking-wider border-b border-slate-800">
                                    <tr>
                                        <th className="py-2.5 px-3 font-semibold">Cargo</th>
                                        <th className="py-2.5 px-3 font-semibold">Categoria</th>
                                        <th className="py-2.5 px-3 font-semibold text-center">Planejado</th>
                                        <th className="py-2.5 px-3 font-semibold text-center">Alocado (Pico)</th>
                                        <th className="py-2.5 px-3 font-semibold text-center">Desvio</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/80">
                                    {moRoleRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="py-8 text-center text-slate-400">
                                                Nenhum cargo encontrado para os filtros aplicados.
                                            </td>
                                        </tr>
                                    ) : (
                                        moRoleRows.map(row => {
                                            const isIsolated = selectedMoRole === row.role;
                                            return (
                                                <tr
                                                    key={row.role}
                                                    className={`hover:bg-slate-800/50 transition-colors ${
                                                        isIsolated ? 'bg-sky-500/10' : ''
                                                    }`}
                                                >
                                                    <td className="py-2.5 px-3 font-semibold text-slate-100">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setSelectedMoRole(prev =>
                                                                    prev === row.role ? 'all' : row.role
                                                                )
                                                            }
                                                            className="bg-transparent border-0 p-0 text-left text-inherit font-semibold hover:text-sky-400 cursor-pointer"
                                                            title="Clique para filtrar por cargo"
                                                        >
                                                            {row.role}
                                                        </button>
                                                    </td>
                                                    <td className="py-2.5 px-3">
                                                        <span
                                                            className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${MO_CATEGORY_COLORS[row.category].badge}`}
                                                        >
                                                            {row.category}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-center tabular-nums">
                                                        <div className="inline-flex items-center gap-2 justify-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleQuickMoAdjust(row.role, -1)}
                                                                disabled={
                                                                    (selectedShift === 'shift2'
                                                                        ? row.shift2PlannedRaw
                                                                        : row.admPlanned) <= 0
                                                                }
                                                                className="no-print w-6 h-6 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-sm leading-none flex items-center justify-center cursor-pointer disabled:opacity-40"
                                                                title={`Reduzir ${selectedShift === 'shift2' ? '2º Turno' : 'Turno ADM'}`}
                                                            >
                                                                -
                                                            </button>
                                                            <span className="min-w-[28px] font-bold text-white text-sm">
                                                                {row.planned}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleQuickMoAdjust(row.role, 1)}
                                                                className="no-print w-6 h-6 rounded-md bg-slate-800 hover:bg-sky-600 text-slate-200 hover:text-white border border-slate-700 font-bold text-sm leading-none flex items-center justify-center cursor-pointer transition-colors"
                                                                title={`Aumentar ${selectedShift === 'shift2' ? '2º Turno' : 'Turno ADM'}`}
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-center tabular-nums">
                                                        <span className="font-bold text-slate-200 text-sm">
                                                            {row.peakAllocated}
                                                        </span>
                                                        <span className="text-[11px] text-slate-500 ml-1.5">
                                                            ({row.manDays} H-d)
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-center tabular-nums">
                                                        <span
                                                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold border ${
                                                                row.deviation < 0
                                                                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                                                                    : row.deviation > 0
                                                                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                                                      : 'bg-slate-800 text-slate-300 border-slate-700'
                                                            }`}
                                                        >
                                                            {row.deviation > 0 ? `+${row.deviation}` : row.deviation}{' '}
                                                            ·{' '}
                                                            {row.deviation < 0
                                                                ? 'Déficit'
                                                                : row.deviation > 0
                                                                  ? 'Superávit'
                                                                  : 'Equilibrado'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
