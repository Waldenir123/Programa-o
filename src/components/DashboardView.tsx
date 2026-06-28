import React, { useMemo, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { ScheduleData, Status, STATUS_LABELS, STATUS_COLOR_MAP_DARK, DynamicColumn } from '../state/types';
import { exportDashboardToPdfAgent } from '../utils/exportAgents';
import { getWeek, getWeekRangeStr } from '../utils/dataUtils';

import ChartDataLabels from 'chartjs-plugin-datalabels';

export const DashboardView: React.FC<{ data: ScheduleData, title: string, programmerName: string, dynamicColumns: DynamicColumn[] }> = ({ data, title, programmerName, dynamicColumns }) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);
    const pieChartRef = useRef<HTMLCanvasElement>(null);
    const pieChartInstance = useRef<Chart | null>(null);

    const breakdownCol = useMemo(() => {
        // Use the first dynamic column available for categorization (usually 'Fase/Agrupador')
        return (dynamicColumns || [])[0];
    }, [dynamicColumns]);

    const [allWeeks, availableWeeks] = useMemo(() => {
        const weekMap = new Map<number, Date>();
        (data || []).forEach(group => {
            (group.tarefas || []).forEach(task => {
                (task.activities || []).forEach(activity => {
                    if (activity && activity.schedule) {
                        Object.keys(activity.schedule).forEach(dateStr => {
                            const date = new Date(dateStr + 'T00:00:00Z');
                            const w = getWeek(date);
                            if (!weekMap.has(w)) {
                                weekMap.set(w, date);
                            }
                        });
                    }
                });
            });
        });
        const sortedWeeks = Array.from(weekMap.keys()).sort((a, b) => a - b);
        return [sortedWeeks, sortedWeeks.map(w => ({ value: w, label: `Semana ${w} - ${getWeekRangeStr(weekMap.get(w)!)}` }))];
    }, [data]);
    
    const [selectedWeek, setSelectedWeek] = React.useState<number | 'all'>(availableWeeks.length > 0 ? availableWeeks[availableWeeks.length-1].value : 'all');

    const stats = useMemo(() => {
        let filteredData = data;
        if (selectedWeek !== 'all') {
            filteredData = JSON.parse(JSON.stringify(data)); // Deep clone to avoid modifying original data
            (filteredData || []).forEach(group => {
                (group.tarefas || []).forEach(task => {
                    (task.activities || []).forEach(activity => {
                        if (activity && activity.schedule) {
                            activity.schedule = Object.entries(activity.schedule)
                                .filter(([dateStr]) => getWeek(new Date(dateStr)) === selectedWeek)
                                .reduce((acc, [dateStr, status]) => ({ ...acc, [dateStr]: status }), {});
                        }
                    });
                });
            });
        }
        
        let totalProgramado = 0;
        let totalRealizado = 0;
        let totalCancelado = 0;
        let totalNaoRealizado = 0;
        let totalProgramadoPast = 0; // Para semanas que já passaram
        const tasksPerComponent = new Map<string, number>();
        const currentWeek = getWeek(new Date());

        (filteredData || []).forEach(group => {
            const componentName = breakdownCol ? (group.customValues?.[breakdownCol.id] || 'Outros') : 'Sem Agrupador';
            let componentTaskCount = tasksPerComponent.get(componentName) || 0;
            (group.tarefas || []).forEach(task => {
                (task.activities || []).forEach(activity => {
                    if (activity && activity.schedule) {
                        Object.entries(activity.schedule).forEach(([dateStr, status]) => {
                            const date = new Date(dateStr + 'T00:00:00Z');
                            const w = getWeek(date);
                            const isPastWeek = w < currentWeek;

                            componentTaskCount++;

                            if (status === Status.Realizado) totalRealizado++;
                            else if (status === Status.Cancelado) totalCancelado++;
                            else if (status === Status.NaoRealizado) totalNaoRealizado++;
                            else if (status === Status.Programado) {
                                if (isPastWeek) {
                                    // Activities left as 'Programado' in past weeks are functionally 'Não Realizado'
                                    totalNaoRealizado++;
                                } else {
                                    totalProgramado++;
                                }
                            }

                            if (isPastWeek) {
                                // "o TOTAL DE ATIVIDADES PROGRAMADAS, PARA SEMANAS QUE JA PASSARAM DEVE SER O TOTAL ENTRE ATVIDADES REALZIADAS, NAO REALIZADAS E CANCELADAS"
                                totalProgramadoPast++;
                            }
                        });
                    }
                });
            });
            tasksPerComponent.set(componentName, componentTaskCount);
        });

        // Add the computed past programado to the total programado figure, since it now includes the sum of Realizado + NaoRealizado + Cancelado for past weeks
        totalProgramado += totalProgramadoPast;

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

    useEffect(() => {
        if (pieChartRef.current) {
            if (pieChartInstance.current) {
                pieChartInstance.current.destroy();
            }
            const ctx = pieChartRef.current.getContext('2d');
            if (ctx) {
                const dataValues = [stats.totalRealizado, stats.totalNaoRealizado, stats.totalCancelado];
                const total = dataValues.reduce((a, b) => a + b, 0);
                
                pieChartInstance.current = new Chart(ctx, {
                    type: 'pie',
                    plugins: [ChartDataLabels],
                    data: {
                        labels: [STATUS_LABELS[Status.Realizado], STATUS_LABELS[Status.NaoRealizado], STATUS_LABELS[Status.Cancelado]],
                        datasets: [{
                            data: dataValues.map(v => total > 0 ? ((v / total) * 100).toFixed(1) : 0),
                            backgroundColor: [
                                STATUS_COLOR_MAP_DARK[Status.Realizado],
                                STATUS_COLOR_MAP_DARK[Status.NaoRealizado],
                                STATUS_COLOR_MAP_DARK[Status.Cancelado]
                            ],
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom' },
                            title: { display: true, text: '% de Atividades' },
                            datalabels: {
                                formatter: (value, context) => {
                                    return value > 0 ? value + '%' : '';
                                },
                                color: '#fff',
                                font: {
                                    weight: 'bold',
                                    size: 14,
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return context.label + ': ' + context.parsed + '%';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
        return () => {
            if (pieChartInstance.current) {
                pieChartInstance.current.destroy();
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
                 <div className="chart-card" style={{ flex: 1, backgroundColor: '#fff', padding: '16px', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'center' }}>
                    <canvas ref={pieChartRef}></canvas>
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
