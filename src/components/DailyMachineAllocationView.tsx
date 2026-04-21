import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Project, ScheduleData, STATUS_CLASS_MAP, MACHINE_CATEGORIES, Machine } from '../state/types';
import { formatDate, getDayAbbr, getWeek, safeJsonParse } from '../utils/dataUtils';

export const DailyMachineAllocationView: React.FC<{
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    dates: Date[];
    filteredData: ScheduleData;
    title: string;
    dateColumnWidth: number;
    allMachineAllocationsGlobal?: Record<string, Record<string, { projectId: string; projectName: string }[]>>;
    zoomLevel: number;
}> = ({ project, setProject, dates, filteredData, title, dateColumnWidth, allMachineAllocationsGlobal, zoomLevel }) => {
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
    const [dragOverInfo, setDragOverInfo] = useState<{ activityId: string; date: string } | null>(null);

    const [fixedColumnWidths, setFixedColumnWidths] = useState([60, 140, 220]);
    const [resizingInfo, setResizingInfo] = useState({ isResizing: false, columnIndex: null as number | null, startX: 0, startWidth: 0 });

    const mainTableRef = useRef<HTMLDivElement>(null);

    const handleResizeStart = useCallback((columnIndex: number, e: React.MouseEvent) => {
        e.preventDefault();
        setResizingInfo({
            isResizing: true,
            columnIndex,
            startX: e.clientX,
            startWidth: fixedColumnWidths[columnIndex],
        });
    }, [fixedColumnWidths]);

    const handleResize = useCallback((e: MouseEvent) => {
        if (!resizingInfo.isResizing || resizingInfo.columnIndex === null) return;
        const dx = e.clientX - resizingInfo.startX;
        const newWidth = Math.max(50, resizingInfo.startWidth + dx);
        setFixedColumnWidths(currentWidths => {
            const newWidths = [...currentWidths];
            newWidths[resizingInfo.columnIndex!] = newWidth;
            return newWidths;
        });
    }, [resizingInfo]);

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

    const stickyColumnPositions = useMemo(() => {
        const positions = [0];
        for (let i = 0; i < fixedColumnWidths.length - 1; i++) {
            positions.push(positions[i] + fixedColumnWidths[i]);
        }
        return positions;
    }, [fixedColumnWidths]);
    
    const toggleCategory = (category: string) => {
        setCollapsedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });
    };

    const handleDragStart = (e: React.DragEvent<HTMLLIElement>, machineId: string) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ type: 'machine', machineId }));
        e.dataTransfer.effectAllowed = 'copy';
    };

    const handleDrop = (e: React.DragEvent<HTMLTableCellElement>, activityId: string, date: string) => {
        e.preventDefault();
        setDragOverInfo(null);
        try {
            const dataString = e.dataTransfer.getData('application/json');
            const data = safeJsonParse<any>(dataString, null);
            if (!data) return;
            if (data && data.type === 'machine') {
                const { machineId } = data;
                setProject(prev => {
                    if (!prev) return null;
                    const newDaily = { ...(prev.dailyMachineAllocation || {}) };
                    if (!newDaily[activityId]) newDaily[activityId] = {};
                    if (!newDaily[activityId][date]) newDaily[activityId][date] = [];
                    
                    if (!newDaily[activityId][date].includes(machineId)) {
                        newDaily[activityId][date] = [...newDaily[activityId][date], machineId];
                    }
                    
                    return { ...prev, dailyMachineAllocation: newDaily };
                });
            }
        } catch (err) {
            console.error("Failed to handle drop", err);
        }
    };

    const handleRemoveAllocation = (activityId: string, date: string, machineId: string) => {
        setProject(prev => {
            if (!prev) return null;
            const newDaily = { ...(prev.dailyMachineAllocation || {}) };
            if (newDaily[activityId] && newDaily[activityId][date]) {
                newDaily[activityId][date] = newDaily[activityId][date].filter(id => id !== machineId);
                if (newDaily[activityId][date].length === 0) delete newDaily[activityId][date];
                if (Object.keys(newDaily[activityId]).length === 0) delete newDaily[activityId];
            }
            return { ...prev, dailyMachineAllocation: newDaily };
        });
    };
    
    const ColGroup = () => (
        <colgroup>
            {fixedColumnWidths.map((width, index) => <col key={`col-fixed-${index}`} style={{ width: `${width}px` }} />)}
            {dates.map(date => <col key={`col-date-${formatDate(date)}`} style={{ width: `${dateColumnWidth}px`, minWidth: `${dateColumnWidth}px` }} />)}
        </colgroup>
    );

    const TableHeader = () => {
        const headers = ['ID', 'Fase/Agrupador', 'Tarefa Principal'];
        const weekSpans = useMemo(() => {
            const spans: { week: number; count: number }[] = [];
            if(dates.length > 0) {
                let currentWeek = getWeek(dates[0]);
                let count = 0;
                dates.forEach(date => {
                    const week = getWeek(date);
                    if (week === currentWeek) count++;
                    else {
                        spans.push({ week: currentWeek, count });
                        currentWeek = week;
                        count = 1;
                    }
                });
                spans.push({ week: currentWeek, count });
            }
            return spans;
        }, [dates]);

        return (
            <thead>
                <tr>
                    {headers.map((header, index) => (
                        <th
                            key={header}
                            rowSpan={3}
                            className={`col-sticky col-sticky-${index + 1}`}
                            style={{ width: fixedColumnWidths[index], left: stickyColumnPositions[index] }}
                        >
                            <div className="header-content">{header}</div>
                            <div className="resize-handle" onMouseDown={(e) => handleResizeStart(index, e)}></div>
                        </th>
                    ))}
                    {weekSpans.map(s => <th key={s.week} colSpan={s.count} className="week-header">Semana {s.week}</th>)}
                </tr>
                <tr>
                    {dates.map(d => {
                        const dayAbbr = getDayAbbr(d);
                        const weekendClass = dayAbbr === 'SÁB' || dayAbbr === 'DOM' ? 'saturday-col' : '';
                        return <th key={`dayhead-${formatDate(d)}`} className={weekendClass}>{dayAbbr}</th>
                    })}
                </tr>
                 <tr>
                    {dates.map(d => {
                        const dayAbbr = getDayAbbr(d);
                        const weekendClass = dayAbbr === 'SÁB' || dayAbbr === 'DOM' ? 'saturday-col' : '';
                        return <th key={`datehead-${formatDate(d)}`} className={weekendClass}>{d.getUTCDate()}</th>
                    })}
                </tr>
            </thead>
        );
    };

    const machinesMap = useMemo(() => {
        const map: Record<string, Machine> = {};
        project.machines.forEach(m => map[m.id] = m);
        return map;
    }, [project.machines]);

    return (
        <div className="daily-allocation-view" style={{ zoom: zoomLevel / 100 }}>
            <aside className="daily-allocation-sidebar">
                <h3>Máquinas Disponíveis</h3>
                {MACHINE_CATEGORIES.map(category => {
                    const machines = project.machines.filter(m => m.category === category && m.status === 'Em funcionamento');
                    if (machines.length === 0) return null;
                    return (
                        <div key={category} className={`role-category ${collapsedCategories.has(category) ? 'collapsed' : ''}`}>
                            <h4 onClick={() => toggleCategory(category)}>
                                {category}
                                <span className="material-icons">expand_more</span>
                            </h4>
                            {!collapsedCategories.has(category) && (
                                <ul>
                                    {machines.map(machine => (
                                        <li 
                                          key={machine.id} 
                                          draggable 
                                          onDragStart={(e) => handleDragStart(e, machine.id)}
                                          onDragEnd={() => setDragOverInfo(null)}
                                        >
                                          {machine.name}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })}
                {project.machines.length === 0 && (
                    <p style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>Nenhuma máquina em funcionamento para alocar. Cadastre máquinas na aba "Máquinas".</p>
                )}
            </aside>
            <main className="daily-allocation-main">
                 <div className="view-header" style={{padding: '0 8px', marginBottom: 0}}>
                    <h2>Alocação Diária de Máquinas</h2>
                </div>
                
                <div className="table-wrapper" ref={mainTableRef}>
                    <table className="schedule-table">
                        <ColGroup />
                        <TableHeader />
                         <tbody>
                            {filteredData.flatMap((group, gIdx) =>
                                group.tarefas.flatMap((task, tIdx) =>
                                    task.activities.map((activity, aIdx) => {
                                        const wbsId = `${gIdx + 1}.${tIdx + 1}.${aIdx + 1}`;
                                        const groupFa = group.customValues?.fa || 'N/A';
                                        return (
                                            <tr key={activity.id}>
                                                <td className="id-cell col-sticky col-sticky-1" style={{ width: fixedColumnWidths[0], left: stickyColumnPositions[0] }}>{wbsId}</td>
                                                <td className="col-sticky col-sticky-2" style={{textAlign: 'left', padding: '0 8px', width: fixedColumnWidths[1], left: stickyColumnPositions[1], fontSize: '0.75rem', color: '#64748b' }}>{groupFa}</td>
                                                <td className="col-sticky col-sticky-3" style={{textAlign: 'left', padding: '0 8px', width: fixedColumnWidths[2], left: stickyColumnPositions[2]}}>{task.title} - {activity.name}</td>
                                                {dates.map(date => {
                                                    const dateStr = formatDate(date);
                                                    const status = activity.schedule[dateStr];
                                                    const allocatedIds = project.dailyMachineAllocation?.[activity.id]?.[dateStr] || [];
                                                    const isDroppable = !!status;
                                                    const isDragOver = dragOverInfo?.activityId === activity.id && dragOverInfo.date === dateStr;

                                                    // Calculate if any machine in this cell has a conflict elsewhere
                                                    let hasConflict = false;
                                                    let conflictDetails: string[] = [];

                                                    if (allMachineAllocationsGlobal) {
                                                        allocatedIds.forEach(mId => {
                                                            const globalUsage = allMachineAllocationsGlobal[mId]?.[dateStr] || [];
                                                            // Conflict if used in more than 1 project
                                                            if (globalUsage.length > 1) {
                                                                hasConflict = true;
                                                                const others = globalUsage
                                                                    .filter(u => u.projectId !== project.id)
                                                                    .map(u => u.projectName);
                                                                if (others.length > 0) {
                                                                    conflictDetails.push(`${machinesMap[mId]?.name}: Em uso em ${others.join(', ')}`);
                                                                }
                                                            }
                                                        });
                                                    }

                                                    return (
                                                        <td
                                                            key={dateStr}
                                                            title={conflictDetails.length > 0 ? `AVISO DE CONFLITO:\n${conflictDetails.join('\n')}` : undefined}
                                                            className={`status-cell ${status ? STATUS_CLASS_MAP[status] : ''} ${getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'saturday-col' : ''} ${isDragOver && isDroppable ? 'droppable-hover' : ''} ${hasConflict ? 'conflict-cell' : ''}`}
                                                            onDragOver={(e) => { if (isDroppable) { e.preventDefault(); setDragOverInfo({ activityId: activity.id, date: dateStr }); } }}
                                                            onDragLeave={() => setDragOverInfo(null)}
                                                            onDrop={(e) => isDroppable && handleDrop(e, activity.id, dateStr)}
                                                        >
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '2px' }}>
                                                                {allocatedIds.map(mid => (
                                                                    <div 
                                                                        key={mid} 
                                                                        className="allocation-text-bubble" 
                                                                        style={{ 
                                                                            backgroundColor: '#fff', 
                                                                            border: '1px solid #cbd5e1', 
                                                                            borderRadius: '2px',
                                                                            display: 'flex',
                                                                            justifyContent: 'space-between',
                                                                            alignItems: 'center'
                                                                        }}
                                                                    >
                                                                        <span>{machinesMap[mid]?.name || 'Máquina'}</span>
                                                                        <span 
                                                                            className="material-icons" 
                                                                            style={{ fontSize: '10px', cursor: 'pointer', marginLeft: '2px' }}
                                                                            onClick={() => handleRemoveAllocation(activity.id, dateStr, mid)}
                                                                        >close</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })
                                )
                            )}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
};
