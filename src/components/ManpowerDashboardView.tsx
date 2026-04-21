import React, { useMemo, useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { Project } from '../state/types';
import { exportManpowerDashboardToPdfAgent } from '../utils/exportAgents';
import { getDateRangeOfWeek } from '../utils/dataUtils';

const SHIFT_COLORS = {
    adm: 'rgba(74, 144, 226, 0.9)', // Blue
    shift2: 'rgba(245, 166, 35, 0.9)' // Orange
};
const SHIFT_BORDER_COLORS = {
    adm: 'rgba(60, 120, 190, 1)',
    shift2: 'rgba(215, 140, 20, 1)'
};

export const ManpowerDashboardView: React.FC<{
    project: Project;
    dates: Date[];
    title: string;
    programmerName: string;
}> = ({ project, title, programmerName }) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);
    const [viewMode, setViewMode] = useState<'byWeek' | 'byRole'>('byWeek');
    const [selectedWeek, setSelectedWeek] = useState<string>('');

    const allProjectWeeks = useMemo(() => {
        const weekSet = new Set<string>();
        const { adm, shift2 } = project.manpowerAllocation.data;
        Object.values(adm).forEach(roleData => Object.keys(roleData).forEach(w => weekSet.add(w)));
        Object.values(shift2).forEach(roleData => Object.keys(roleData).forEach(w => weekSet.add(w)));
        return Array.from(weekSet).sort();
    }, [project.manpowerAllocation.data]);

    useEffect(() => {
        if (!selectedWeek && allProjectWeeks.length > 0) {
            setSelectedWeek(allProjectWeeks[0]);
        }
    }, [allProjectWeeks, selectedWeek]);

    const chartConfig = useMemo(() => {
        const { roles, data, hasSecondShift } = project.manpowerAllocation;

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' as const },
            },
            animation: {
                onComplete: ({ chart }: { chart: Chart }) => {
                    const ctx = chart.ctx;
                    ctx.font = 'bold 11px Arial';
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    chart.data.datasets.forEach((dataset, i) => {
                        const meta = chart.getDatasetMeta(i);
                        if (!meta.hidden) {
                            meta.data.forEach((bar, index) => {
                                const value = dataset.data[index] as number;
                                if (value > 0) {
                                    const { y, base, height } = bar as any;
                                    const yPos = (chart.options.scales?.y as any)?.stacked ? base - (height / 2) : y + (height / 2);
                                    ctx.fillText(String(value), bar.x, yPos);
                                }
                            });
                        }
                    });
                }
            }
        };

        if (viewMode === 'byWeek') {
            const labels = allProjectWeeks.map(w => `Semana ${w.split('-')[1]}`);
            const admData = allProjectWeeks.map(week =>
                roles.reduce((sum, role) => sum + (data.adm[role]?.[week] || 0), 0)
            );
            const shift2Data = allProjectWeeks.map(week =>
                hasSecondShift ? roles.reduce((sum, role) => sum + (data.shift2[role]?.[week] || 0), 0) : 0
            );

            return {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Turno ADM', data: admData, backgroundColor: SHIFT_COLORS.adm, borderColor: SHIFT_BORDER_COLORS.adm, borderWidth: 1 },
                        { label: '2º Turno', data: shift2Data, backgroundColor: SHIFT_COLORS.shift2, borderColor: SHIFT_BORDER_COLORS.shift2, borderWidth: 1 }
                    ]
                },
                options: { ...commonOptions,
                    plugins: { ...commonOptions.plugins, title: { display: true, text: 'Total de Mão de Obra por Semana', font: {size: 16} } },
                    scales: {
                        x: { stacked: false },
                        y: { stacked: false, beginAtZero: true, title: { display: true, text: 'Quantidade de Pessoas' } }
                    }
                }
            };
        }

        if (viewMode === 'byRole' && selectedWeek) {
            const labels = roles;
            const admData = roles.map(role => data.adm[role]?.[selectedWeek] || 0);
            const shift2Data = roles.map(role => hasSecondShift ? (data.shift2[role]?.[selectedWeek] || 0) : 0);

            return {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Turno ADM', data: admData, backgroundColor: SHIFT_COLORS.adm, borderColor: SHIFT_BORDER_COLORS.adm, borderWidth: 1 },
                        { label: '2º Turno', data: shift2Data, backgroundColor: SHIFT_COLORS.shift2, borderColor: SHIFT_BORDER_COLORS.shift2, borderWidth: 1 }
                    ]
                },
                options: { ...commonOptions,
                    plugins: { ...commonOptions.plugins, title: { display: true, text: `Histograma de Mão de Obra para a Semana ${selectedWeek.split('-')[1]}`, font: {size: 16} } },
                    scales: {
                        x: { stacked: true },
                        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Quantidade de Pessoas' } }
                    }
                }
            };
        }
        return null;
    }, [viewMode, selectedWeek, allProjectWeeks, project.manpowerAllocation]);

    useEffect(() => {
        if (chartRef.current && chartConfig) {
            if (chartInstance.current) chartInstance.current.destroy();
            const ctx = chartRef.current.getContext('2d');
            if (ctx) {
                chartInstance.current = new Chart(ctx, {
                    type: 'bar',
                    data: chartConfig.data,
                    options: chartConfig.options as any,
                });
            }
        }
        return () => { if (chartInstance.current) chartInstance.current.destroy(); };
    }, [chartConfig]);

    const handleExport = () => {
        const chartImage = chartInstance.current ? chartInstance.current.toBase64Image() : null;
        const selectedWeekInfo = viewMode === 'byWeek' ? "Total por Semana" : `Semana ${selectedWeek.split('-')[1]} (${getDateRangeOfWeek(selectedWeek)})`;
        exportManpowerDashboardToPdfAgent(chartImage, title, programmerName, selectedWeekInfo);
    };
    
    return (
        <div className="manpower-dashboard-view">
            <div className="view-header">
                <div>
                    <h2>Dashboard de Mão de Obra</h2>
                    <p className="dashboard-subtitle">
                        {`Nova Programação Semanal - ${project.title} - Responsável: ${programmerName}`}
                    </p>
                </div>
                <div className="view-controls">
                    <div className="control-button-group">
                        <button className={`control-button ${viewMode === 'byRole' ? 'active' : ''}`} onClick={() => setViewMode('byRole')}>
                            Por Função
                        </button>
                        <button className={`control-button ${viewMode === 'byWeek' ? 'active' : ''}`} onClick={() => setViewMode('byWeek')}>
                            Total por Semana
                        </button>
                    </div>

                    {viewMode === 'byRole' && (
                        <div className="dashboard-controls">
                            <label htmlFor="manpower-week-filter">Selecionar Semana:</label>
                            <select
                                id="manpower-week-filter"
                                className="dashboard-select"
                                value={selectedWeek}
                                onChange={e => setSelectedWeek(e.target.value)}
                            >
                                {allProjectWeeks.map(w => <option key={w} value={w}>Semana {w.split('-')[1]} ({w.split('-')[0]}) {getDateRangeOfWeek(w)}</option>)}
                            </select>
                        </div>
                    )}
                    <button className="control-button" onClick={handleExport}><span className="material-icons">print</span> Imprimir</button>
                </div>
            </div>
            <div className="chart-card" style={{ flex: 1, backgroundColor: '#fff', padding: '16px', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', height: 'calc(100% - 80px)' }}>
                <canvas ref={chartRef}></canvas>
            </div>
        </div>
    );
};
