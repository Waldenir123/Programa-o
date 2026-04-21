import React, { useMemo, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { ScheduleData, Status, STATUS_LABELS, STATUS_COLOR_MAP_DARK, DynamicColumn } from '../state/types';
import { exportDashboardToPdfAgent } from '../utils/exportAgents';
import { getWeek } from '../utils/dataUtils';

export const DashboardView: React.FC<{ data: ScheduleData, title: string, programmerName: string, dynamicColumns: DynamicColumn[] }> = ({ data, title, programmerName, dynamicColumns }) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);

    const breakdownCol = useMemo(() => {
        // Use the first dynamic column available for categorization (usually 'Fase/Agrupador')
        return dynamicColumns[0];
    }, [dynamicColumns]);

    const [allWeeks, availableWeeks] = useMemo(() => {
        const weekSet = new Set<number>();
        data.forEach(group => {
            group.tarefas.forEach(task => {
                task.activities.forEach(activity => {
                    Object.keys(activity.schedule).forEach(dateStr => {
                        weekSet.add(getWeek(new Date(dateStr)));
                    });
                });
            });
        });
        const sortedWeeks = Array.from(weekSet).sort((a, b) => a - b);
        return [sortedWeeks, sortedWeeks.map(w => ({ value: w, label: `Semana ${w}` }))];
    }, [data]);
    
    const [selectedWeek, setSelectedWeek] = React.useState<number | 'all'>(availableWeeks.length > 0 ? availableWeeks[availableWeeks.length-1].value : 'all');

    const stats = useMemo(() => {
        let filteredData = data;
        if (selectedWeek !== 'all') {
            filteredData = JSON.parse(JSON.stringify(data)); // Deep clone to avoid modifying original data
            filteredData.forEach(group => {
                group.tarefas.forEach(task => {
                    task.activities.forEach(activity => {
                        activity.schedule = Object.entries(activity.schedule)
                            .filter(([dateStr]) => getWeek(new Date(dateStr)) === selectedWeek)
                            .reduce((acc, [dateStr, status]) => ({ ...acc, [dateStr]: status }), {});
                    });
                });
            });
        }
        
        let totalProgramado = 0;
        let totalRealizado = 0;
        let totalCancelado = 0;
        let totalNaoRealizado = 0;
        const tasksPerComponent = new Map<string, number>();

        filteredData.forEach(group => {
            const componentName = breakdownCol ? (group.customValues?.[breakdownCol.id] || 'Outros') : 'Sem Agrupador';
            let componentTaskCount = tasksPerComponent.get(componentName) || 0;
            group.tarefas.forEach(task => {
                task.activities.forEach(activity => {
                    Object.values(activity.schedule).forEach(status => {
                        componentTaskCount++;
                        if (status === Status.Programado) totalProgramado++;
                        else if (status === Status.Realizado) totalRealizado++;
                        else if (status === Status.Cancelado) totalCancelado++;
                        else if (status === Status.NaoRealizado) totalNaoRealizado++;
                    });
                });
            });
            tasksPerComponent.set(componentName, componentTaskCount);
        });

        return { totalProgramado, totalRealizado, totalCancelado, totalNaoRealizado, tasksPerComponent };
    }, [data, selectedWeek, breakdownCol]);

    useEffect(() => {
        if (chartRef.current) {
            if (chartInstance.current) {
                chartInstance.current.destroy();
            }
            const ctx = chartRef.current.getContext('2d');
            if (ctx) {
                chartInstance.current = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: Object.values(STATUS_LABELS),
                        datasets: [{
                            label: 'Contagem de Status',
                            data: [stats.totalProgramado, stats.totalRealizado, stats.totalCancelado, stats.totalNaoRealizado],
                            backgroundColor: Object.values(STATUS_COLOR_MAP_DARK),
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            title: { display: true, text: 'Distribuição de Status das Atividades' }
                        }
                    }
                });
            }
        }
        return () => {
            if (chartInstance.current) {
                chartInstance.current.destroy();
            }
        };
    }, [stats]);
    
    const handleExport = () => {
        const chartImage = chartInstance.current ? chartInstance.current.toBase64Image() : null;
        const selectedWeekInfo = selectedWeek === 'all' ? 'Todo o Período' : `Semana ${selectedWeek}`;
        exportDashboardToPdfAgent(stats, chartImage, title, programmerName, selectedWeekInfo);
    };

    return (
        <div className="dashboard-view">
            <div className="view-header">
                <div>
                    <h2>Dashboard de Performance</h2>
                    <p className="dashboard-subtitle">Análise do andamento do projeto por status e componente.</p>
                </div>
                <div className="view-controls">
                    <div className="dashboard-controls">
                        <label htmlFor="week-filter">Filtrar por Semana:</label>
                        <select id="week-filter" value={selectedWeek} onChange={e => setSelectedWeek(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                            <option value="all">Todo o Período</option>
                            {availableWeeks.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                        </select>
                    </div>
                    <button className="control-button" onClick={handleExport}><span className="material-icons">picture_as_pdf</span> Exportar para PDF</button>
                </div>
            </div>
            <div className="stats-grid">
                <div className="stat-card"><h3>Programado</h3><p>{stats.totalProgramado}</p></div>
                <div className="stat-card"><h3>Realizado</h3><p>{stats.totalRealizado}</p></div>
                <div className="stat-card"><h3>Cancelado</h3><p>{stats.totalCancelado}</p></div>
                <div className="stat-card"><h3>Não Realizado</h3><p>{stats.totalNaoRealizado}</p></div>
            </div>
            <div className="charts-container" style={{ display: 'flex', gap: '16px', flexGrow: 1 }}>
                 <div className="chart-card" style={{ flex: 1, backgroundColor: '#fff', padding: '16px', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)' }}>
                    <canvas ref={chartRef}></canvas>
                </div>
                <div className="stat-card" style={{flex: 1}}>
                    <h3>Atividades por Componente</h3>
                    <ul>
                        {Array.from(stats.tasksPerComponent.entries()).map(([component, count]) => (
                            <li key={component}><strong>{component}:</strong> {count} atividades</li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
};
