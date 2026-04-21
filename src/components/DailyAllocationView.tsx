import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Project, ScheduleData, STATUS_CLASS_MAP, MANPOWER_CATEGORIES } from '../state/types';
import { formatDate, getDayAbbr, getWeek, getWeekYear, getRoleAbbreviation, safeJsonParse } from '../utils/dataUtils';
import { exportDailyAllocationToPdfAgent } from '../utils/exportAgents';

const AllocationPopover = ({ popover, project, setProject, onClose }: {
    popover: { activityId: string, date: string, element: HTMLElement };
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    onClose: () => void;
}) => {
    const popoverRef = useRef<HTMLDivElement>(null);
    const { activityId, date, element } = popover;
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node) &&
                !element.contains(event.target as Node)
            ) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose, element]);

    const handleAllocationChange = (role: string, value: string) => {
        const quantity = parseInt(value, 10);
        setProject(prev => {
            if (!prev) return null;
            const newDaily = JSON.parse(JSON.stringify(prev.dailyManpowerAllocation));
            if (!newDaily[activityId]) newDaily[activityId] = {};
            if (!newDaily[activityId][date]) newDaily[activityId][date] = {};
            
            if (isNaN(quantity) || quantity <= 0) {
                delete newDaily[activityId][date][role];
                if (Object.keys(newDaily[activityId][date]).length === 0) delete newDaily[activityId][date];
                if (Object.keys(newDaily[activityId]).length === 0) delete newDaily[activityId];
            } else {
                newDaily[activityId][date][role] = quantity;
            }
            return { ...prev, dailyManpowerAllocation: newDaily };
        });
    };

    const rect = element.getBoundingClientRect();
    const style: React.CSSProperties = {
        position: 'fixed',
        top: `${rect.bottom + 5}px`,
        left: `${rect.left + (rect.width / 2) - 125}px`,
        transform: 'translateX(0)',
    };
    
    // Adjust position if it overflows the viewport
    if (style.left && (style.left as number) + 250 > window.innerWidth) {
        style.left = window.innerWidth - 255;
    }
    if (style.left && (style.left as number) < 5) {
        style.left = 5;
    }

    return (
        <div className="allocation-popover" ref={popoverRef} style={style}>
            <h4>Alocar MO para {date}</h4>
            <div className="allocation-popover-list">
                {project.manpowerAllocation.roles.map(role => {
                    const currentQty = project.dailyManpowerAllocation[activityId]?.[date]?.[role] || 0;
                    return (
                        <div key={role} className="allocation-popover-item">
                            <label htmlFor={`alloc-${role}`}>{role}</label>
                            <div className="allocation-control">
                                <button onClick={() => handleAllocationChange(role, (currentQty - 1).toString())}>-</button>
                                <span>{currentQty}</span>
                                <button onClick={() => handleAllocationChange(role, (currentQty + 1).toString())}>+</button>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    );
};


export const DailyAllocationView: React.FC<{
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    dates: Date[];
    filteredData: ScheduleData;
    title: string;
    dateColumnWidth: number;
    zoomLevel: number;
}> = ({ project, setProject, dates, filteredData, title, dateColumnWidth, zoomLevel }) => {
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
    const [popover, setPopover] = useState<{ activityId: string, date: string, element: HTMLElement } | null>(null);
    const [dragOverInfo, setDragOverInfo] = useState<{ activityId: string; date: string } | null>(null);

    const [fixedColumnWidths, setFixedColumnWidths] = useState([60, 140, 220]);
    const [resizingInfo, setResizingInfo] = useState({ isResizing: false, columnIndex: null as number | null, startX: 0, startWidth: 0 });

    const mainTableRef = useRef<HTMLDivElement>(null);
    const summaryTableRef = useRef<HTMLDivElement>(null);

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
    
    // Sync horizontal scroll
    useEffect(() => {
        const main = mainTableRef.current;
        const summary = summaryTableRef.current;
        if (!main || !summary) return;

        const syncScroll = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target === main) {
                summary.scrollLeft = main.scrollLeft;
            } else {
                main.scrollLeft = summary.scrollLeft;
            }
        };

        main.addEventListener('scroll', syncScroll);
        summary.addEventListener('scroll', syncScroll);
        return () => {
            main.removeEventListener('scroll', syncScroll);
            summary.removeEventListener('scroll', syncScroll);
        };
    }, []);

    const toggleCategory = (category: string) => {
        setCollapsedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });
    };
    
    const handleCellClick = (e: React.MouseEvent<HTMLTableCellElement>, activityId: string, date: string) => {
        if(popover?.activityId === activityId && popover?.date === date) {
            setPopover(null);
        } else {
            setPopover({ activityId, date, element: e.currentTarget });
        }
    };
    
    const summaryData = useMemo(() => {
        const dailyTotals: Record<string, Record<string, number>> = {};
        dates.forEach(date => {
            const dateStr = formatDate(date);
            dailyTotals[dateStr] = {};
            project.manpowerAllocation.roles.forEach(role => { dailyTotals[dateStr][role] = 0; });
        });

        Object.values(project.dailyManpowerAllocation).forEach(activityAllocations => {
            Object.entries(activityAllocations).forEach(([dateStr, roles]) => {
                if (dailyTotals[dateStr]) {
                    Object.entries(roles as Record<string, number>).forEach(([role, quantity]) => {
                        if (dailyTotals[dateStr][role] !== undefined) {
                            dailyTotals[dateStr][role] += quantity;
                        }
                    });
                }
            });
        });

        const weeklyAvailable: Record<string, Record<string, number>> = {};
        const { roles, data: manpowerData, hasSecondShift } = project.manpowerAllocation;
        dates.forEach(date => {
            const weekYear = getWeekYear(date);
            if (!weeklyAvailable[weekYear]) {
                weeklyAvailable[weekYear] = {};
                roles.forEach(role => {
                    const admQty = manpowerData.adm[role]?.[weekYear] || 0;
                    const shift2Qty = hasSecondShift ? (manpowerData.shift2[role]?.[weekYear] || 0) : 0;
                    weeklyAvailable[weekYear][role] = admQty + shift2Qty;
                });
            }
        });
        
        return { dailyTotals, weeklyAvailable };
    }, [project, dates]);

    const handleExport = () => exportDailyAllocationToPdfAgent(project, dates, filteredData, title);

    const handleDragStart = (e: React.DragEvent<HTMLLIElement>, role: string) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ type: 'manpower', role }));
        e.dataTransfer.effectAllowed = 'copy';
    };

    const handleDrop = (e: React.DragEvent<HTMLTableCellElement>, activityId: string, date: string) => {
        e.preventDefault();
        setDragOverInfo(null);
        try {
            const dataString = e.dataTransfer.getData('application/json');
            const data = safeJsonParse<any>(dataString, null);
            if (!data) return;
            if (data && data.type === 'manpower') {
                const { role } = data;
                setProject(prev => {
                    if (!prev) return null;
                    const newProject = JSON.parse(JSON.stringify(prev));
                    const newDaily = newProject.dailyManpowerAllocation;

                    if (!newDaily[activityId]) newDaily[activityId] = {};
                    if (!newDaily[activityId][date]) newDaily[activityId][date] = {};
                    
                    const currentQty = newDaily[activityId][date][role] || 0;
                    newDaily[activityId][date][role] = currentQty + 1;
                    
                    return newProject;
                });
            }
        } catch (err) {
            console.error("Failed to handle drop", err);
        }
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

    const SummaryTable = () => {
        const weekSpans = useMemo(() => {
            if (dates.length === 0) return [];
            const spans: { week: number; count: number }[] = [];
            let currentWeek = getWeek(dates[0]);
            let count = 0;
            dates.forEach(date => {
                const week = getWeek(date);
                if (week === currentWeek) {
                    count++;
                } else {
                    spans.push({ week: currentWeek, count });
                    currentWeek = week;
                    count = 1;
                }
            });
            spans.push({ week: currentWeek, count });
            return spans;
        }, [dates]);

        return (
            <div className="table-wrapper summary-table-wrapper" ref={summaryTableRef}>
                <table className="schedule-table daily-allocation-summary-table">
                    <ColGroup />
                    <thead>
                        <tr>
                            <th colSpan={3} rowSpan={3} className="col-sticky col-sticky-1 summary-header" style={{ width: fixedColumnWidths.slice(0, 3).reduce((a, b) => a + b, 0), left: 0 }}>
                                {title === 'Manpower' ? 'Resumo de Alocação Diária' : 'Resumo de Alocação de Máquinas'}
                            </th>
                            {weekSpans.map(span => <th key={`summary-week-${span.week}`} colSpan={span.count} className="week-header">Semana {span.week}</th>)}
                        </tr>
                        <tr>
                            {dates.map(date => {
                                const dayAbbr = getDayAbbr(date);
                                const weekendClass = dayAbbr === 'SÁB' || dayAbbr === 'DOM' ? 'saturday-col' : '';
                                return <th key={`summary-day-${formatDate(date)}`} className={weekendClass}>{dayAbbr}</th>;
                            })}
                        </tr>
                        <tr>
                            {dates.map(date => {
                                const dayAbbr = getDayAbbr(date);
                                const weekendClass = dayAbbr === 'SÁB' || dayAbbr === 'DOM' ? 'saturday-col' : '';
                                return <th key={`summary-date-${formatDate(date)}`} className={weekendClass}>{date.getUTCDate()}</th>;
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {project.manpowerAllocation.roles.map(role => (
                            <tr key={`summary-row-${role}`}>
                                <td colSpan={3} className="col-sticky col-sticky-1" style={{ width: fixedColumnWidths.slice(0, 3).reduce((a, b) => a + b, 0), left: 0, textAlign: 'left', padding: '0 8px', fontWeight: 'bold' }}>
                                    {role}
                                </td>
                                {dates.map(date => {
                                    const dateStr = formatDate(date);
                                    const weekYear = getWeekYear(date);
                                    const totalDaily = summaryData.dailyTotals[dateStr]?.[role] || 0;
                                    const availableWeekly = summaryData.weeklyAvailable[weekYear]?.[role] || 0;
                                    const isSuperAllocated = totalDaily > availableWeekly;
                                    const weekendClass = getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'saturday-col' : '';
                                    return (
                                        <td key={`summary-cell-${role}-${dateStr}`} className={`${isSuperAllocated ? 'super-allocated' : ''} ${weekendClass}`}>
                                            {`${totalDaily} / ${availableWeekly}`}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colSpan={3} className="col-sticky col-sticky-1" style={{ width: fixedColumnWidths.slice(0, 3).reduce((a, b) => a + b, 0), left: 0, textAlign: 'left', fontWeight: 'bold', padding: '0 8px' }}>
                                <strong>TOTAL GERAL</strong>
                            </td>
                            {dates.map(date => {
                                const dateStr = formatDate(date);
                                const weekYear = getWeekYear(date);
                                const totalDaily = (Object.values(summaryData.dailyTotals[dateStr] || {}) as number[]).reduce((a, b) => a + b, 0);
                                const availableWeekly = (Object.values(summaryData.weeklyAvailable[weekYear] || {}) as number[]).reduce((a, b) => a + b, 0);
                                const isSuperAllocated = totalDaily > availableWeekly;
                                const weekendClass = getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'saturday-col' : '';
                                return (
                                    <td key={`summary-total-${dateStr}`} className={`${isSuperAllocated ? 'super-allocated' : ''} ${weekendClass}`} style={{ fontWeight: 'bold' }}>
                                        {`${totalDaily} / ${availableWeekly}`}
                                    </td>
                                );
                            })}
                        </tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    return (
        <div className="daily-allocation-view" style={{ zoom: zoomLevel / 100 }}>
            {popover && <AllocationPopover popover={popover} project={project} setProject={setProject} onClose={() => setPopover(null)} />}
            <aside className="daily-allocation-sidebar">
                <h3>Mão de Obra</h3>
                {Object.entries(MANPOWER_CATEGORIES).map(([category, roles]) => (
                    <div key={category} className={`role-category ${collapsedCategories.has(category) ? 'collapsed' : ''}`}>
                        <h4 onClick={() => toggleCategory(category)}>
                            {category}
                            <span className="material-icons">expand_more</span>
                        </h4>
                        {!collapsedCategories.has(category) && (
                            <ul>
                                {roles.filter(r => project.manpowerAllocation.roles.includes(r)).map(role => (
                                    <li 
                                      key={role} 
                                      draggable 
                                      onDragStart={(e) => handleDragStart(e, role)}
                                      onDragEnd={() => setDragOverInfo(null)}
                                    >
                                      {role}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ))}
                 {/* This section can be for un-categorized roles */}
                <div className="role-category">
                     <h4>Outros</h4>
                     <ul>
                        {project.manpowerAllocation.roles
                            .filter(r => !Object.values(MANPOWER_CATEGORIES).flat().includes(r))
                            .map(role => (
                            <li key={role} draggable onDragStart={e => handleDragStart(e, role)} onDragEnd={() => setDragOverInfo(null)}>
                                {role}
                            </li>
                        ))}
                    </ul>
                </div>
            </aside>
            <main className="daily-allocation-main">
                 <div className="view-header" style={{padding: '0 8px', marginBottom: 0}}>
                    <h2>Alocação Diária de Mão de Obra</h2>
                     <div className="view-controls">
                        <button className="control-button" onClick={handleExport}>
                            <span className="material-icons">print</span> Imprimir Alocação
                        </button>
                    </div>
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
                                                    const allocations = project.dailyManpowerAllocation[activity.id]?.[dateStr];
                                                    const cellText = allocations ? Object.entries(allocations).map(([role, qty]) => `${getRoleAbbreviation(role)}: ${qty}`).join('\n') : '';
                                                    const isDroppable = !!status;
                                                    const isDragOver = dragOverInfo?.activityId === activity.id && dragOverInfo.date === dateStr;

                                                    return (
                                                        <td
                                                            key={dateStr}
                                                            className={`status-cell ${status ? STATUS_CLASS_MAP[status] : ''} ${getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'saturday-col' : ''} ${isDragOver && isDroppable ? 'droppable-hover' : ''}`}
                                                            onClick={(e) => isDroppable && handleCellClick(e, activity.id, dateStr)}
                                                            onDragOver={(e) => { if (isDroppable) { e.preventDefault(); setDragOverInfo({ activityId: activity.id, date: dateStr }); } }}
                                                            onDragLeave={() => setDragOverInfo(null)}
                                                            onDrop={(e) => isDroppable && handleDrop(e, activity.id, dateStr)}
                                                        >
                                                            {cellText && <div className="daily-allocation-cell-content"><span className='allocation-text-bubble'>{cellText}</span></div>}
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
                <SummaryTable />
            </main>
        </div>
    );
};