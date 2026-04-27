import React, { useMemo, useCallback, memo } from 'react';
import { ScheduleData, Status, SelectedItem, Atividade, Grupo, TarefaPrincipal, RenderableRow, STATUS_CLASS_MAP, DynamicColumn } from '../state/types';
import { formatDate, getDayAbbr, getWeek } from '../utils/dataUtils';

// --- Sub-components for better performance ---

interface ScheduleCellProps {
    date: Date;
    activity?: Atividade;
    isActive: boolean;
    isSelected: boolean;
    isCut: boolean;
    isMoving: boolean;
    isGhost: boolean;
    onMouseDown: (e: React.MouseEvent, activityId: string, date: string) => void;
    onMouseEnter: (activityId: string, date: string) => void;
    onRightClick: (e: React.MouseEvent, activityId: string, date: string) => void;
}

const ScheduleCell = memo(({ 
    date, activity, isActive, isSelected, isCut, isMoving, isGhost, 
    onMouseDown, onMouseEnter, onRightClick 
}: ScheduleCellProps) => {
    const dateStr = formatDate(date);
    const status = activity ? activity.schedule[dateStr] : undefined;
    const dayAbbr = getDayAbbr(date);
    const weekendClass = dayAbbr === 'SÁB' || dayAbbr === 'DOM' ? 'saturday-col' : '';

    const cellClasses = [
        'status-cell',
        status ? STATUS_CLASS_MAP[status] : '',
        weekendClass,
        isActive ? 'active-cell' : '',
        isSelected ? 'selected-cell' : '',
        isCut ? 'cut-cell' : '',
        isMoving ? 'moving-cell' : '',
        isGhost ? 'ghost-cell' : '',
    ].filter(Boolean).join(' ');

    return (
        <td 
            data-cell-id={activity ? `${activity.id}-${dateStr}` : `empty-${dateStr}`}
            className={cellClasses}
            onMouseDown={(e) => activity && onMouseDown(e, activity.id, dateStr)}
            onMouseEnter={() => activity && onMouseEnter(activity.id, dateStr)}
            onContextMenu={(e) => activity && onRightClick(e, activity.id, dateStr)}
        >
           {status && <span className="status-indicator">{status}</span>}
        </td>
    );
});

ScheduleCell.displayName = 'ScheduleCell';

interface ScheduleRowProps {
    row: RenderableRow;
    index: number;
    dates: Date[];
    dynamicColumns: DynamicColumn[];
    columnWidths: number[];
    stickyColumnPositions: number[];
    visibleColumns?: Record<string, boolean>;
    selectedItems: SelectedItem[];
    draggedGroupInfo: any;
    draggedActivityInfo: any;
    dropTargetId: string | null;
    activeCell: { activityId: string; date: string } | null;
    selectionBlock: any;
    cutSelectionBlock: any;
    isMovingBlock: boolean;
    ghostBlockCells: Set<string>;
    onRowClick: (e: React.MouseEvent, item: SelectedItem) => void;
    onGroupDragStart: (group: Grupo, index: number) => void;
    onActivityDragStart: (activity: Atividade, taskId: string) => void;
    onActivityDrop: (targetTaskId: string, targetActivityId: string | null) => void;
    onDragEnd: () => void;
    onDropTargetChange: (targetId: string | null) => void;
    onAddItem: (type: 'group' | 'task' | 'activity', parentId?: string) => void;
    onDeleteItem: (id: string, type: 'group' | 'task' | 'activity') => void;
    onTextUpdate: (id: string, field: string, value: string) => void;
    onCellMouseDown: (e: React.MouseEvent, activityId: string, date: string) => void;
    onCellMouseEnter: (activityId: string, date: string) => void;
    onCellRightClick: (e: React.MouseEvent, activityId: string, date: string) => void;
    isCellInBlock: (activityId: string, date: string, block: any) => boolean;
    onMoveItem: (id: string, direction: 'up' | 'down') => void;
}

const ScheduleRow = memo((props: ScheduleRowProps) => {
    const { 
        row, index, dates, dynamicColumns, columnWidths, stickyColumnPositions, visibleColumns,
        selectedItems, draggedGroupInfo, draggedActivityInfo, dropTargetId, activeCell,
        selectionBlock, cutSelectionBlock, isMovingBlock, ghostBlockCells,
        onRowClick, onGroupDragStart, onActivityDragStart, onActivityDrop, onDragEnd, onDropTargetChange,
        onAddItem, onDeleteItem, onTextUpdate,
        onCellMouseDown, onCellMouseEnter, onCellRightClick, isCellInBlock,
        onMoveItem
    } = props;

    const dynamicColumnsBefore = useMemo(() => dynamicColumns.filter(c => c.position !== 'after'), [dynamicColumns]);
    const dynamicColumnsAfter = useMemo(() => dynamicColumns.filter(c => c.position === 'after'), [dynamicColumns]);

    const { group, task, activity, renderGroup, groupRowSpan, renderTask, taskRowSpan, wbsId, isLastInGroup, isLastInTask } = row;

    const isGroupSelected = selectedItems.some(item => item.type === 'group' && item.id === group.id);
    const isTaskSelected = selectedItems.some(item => item.type === 'task' && item.id === task.id);
    const isActivitySelected = selectedItems.some(item => item.type === 'activity' && item.id === activity?.id);
    const isSelected = isActivitySelected || isTaskSelected || isGroupSelected;
    
    const isGroupBeingDragged = draggedGroupInfo?.group.id === group.id;
    const isActivityBeingDragged = draggedActivityInfo?.activity.id === activity?.id;
    const isDropTarget = dropTargetId === group.id || (dropTargetId === activity?.id); // dropTargetId handles both group and activity drops by id

    return (
        <tr
            className={`${isSelected ? 'selected-row' : ''} ${isLastInGroup ? 'group-divider' : ''} ${isLastInTask ? 'task-divider' : ''} ${isGroupBeingDragged || isActivityBeingDragged ? 'group-dragging' : ''} ${isDropTarget ? 'drop-target-top' : ''}`}
            onDragOver={(e) => { 
              e.preventDefault(); 
              if (draggedGroupInfo) onDropTargetChange(group.id);
              if (draggedActivityInfo && activity) onDropTargetChange(activity.id);
              if (draggedActivityInfo && !activity) onDropTargetChange(task.id + '_empty'); // When dropping on empty task
            }}
            onDrop={(e) => {
              if (draggedActivityInfo) {
                 e.preventDefault();
                 onActivityDrop(task.id, activity ? activity.id : null);
              }
            }}
        >
            <td className="col-sticky col-sticky-1 id-cell" style={{ width: columnWidths[0], left: stickyColumnPositions[0], display: visibleColumns && visibleColumns['ID'] === false ? 'none' : 'table-cell' }}>
                <div
                    className="cell-content-wrapper with-drag-handle"
                    onClick={(e) => onRowClick(e, activity ? { id: activity.id, name: activity.name, type: 'activity', wbsId } : { id: task.id, name: task.title, type: 'task', wbsId })}
                >
                    <span
                        className="drag-handle"
                        draggable
                        onDragStart={() => onGroupDragStart(group, index)}
                        onDragEnd={onDragEnd}
                    >
                        <span className="material-icons">drag_indicator</span>
                    </span>
                    {wbsId}
                    <button 
                        className="group-delete-button"
                        onClick={(e) => { e.stopPropagation(); onDeleteItem(group.id, 'group'); }}
                        title="Excluir Grupo"
                        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '20px', height: '20px', pointerEvents: 'auto', border: 'none', cursor: 'pointer' }}
                    >
                        <span className="material-icons" style={{ fontSize: '14px', color: '#ef4444' }}>remove</span>
                    </button>
                </div>
            </td>
            
            {dynamicColumnsBefore.map((col, idx) => {
                const absIdx = idx + 1;
                const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
                const value = group.customValues?.[col.id] || '';

                return (
                    <td 
                        key={col.id} 
                        className={`col-sticky col-sticky-${absIdx + 1}`} 
                        style={{ width: columnWidths[absIdx], left: stickyColumnPositions[absIdx], display: isVisible ? 'table-cell' : 'none' }} 
                        onClick={(e) => onRowClick(e, { id: group.id, name: value, type: 'group', wbsId: wbsId.split('.')[0] })}
                    >
                        <div contentEditable suppressContentEditableWarning onBlur={e => onTextUpdate(group.id, col.id, e.currentTarget.textContent || '')}>
                            {value}
                        </div>
                    </td>
                );
            })}
            
            {renderTask && (
                <td className={`col-sticky col-sticky-${dynamicColumnsBefore.length + 2}`} rowSpan={taskRowSpan} style={{ width: columnWidths[dynamicColumnsBefore.length + 1], left: stickyColumnPositions[dynamicColumnsBefore.length + 1], display: visibleColumns && visibleColumns['TAREFA PRINCIPAL'] === false ? 'none' : 'table-cell' }} onClick={(e) => onRowClick(e, { id: task.id, name: task.title, type: 'task', wbsId: wbsId.split('.').slice(0, 2).join('.') })}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div className="task-title-input" contentEditable suppressContentEditableWarning onBlur={e => onTextUpdate(task.id, 'tarefa', e.currentTarget.textContent || '')} style={{ fontWeight: '500' }}>
                            {task.title}
                        </div>
                        <div className="task-fa-input" contentEditable suppressContentEditableWarning onBlur={e => onTextUpdate(task.id, 'tarefa_fa', e.currentTarget.textContent || '')} style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', borderTop: '1px solid #e2e8f0', paddingTop: '2px' }}>
                            {task.fa || 'Nº FA'}
                        </div>
                    </div>
                    <div className="cell-actions" style={{ display: 'flex', gap: '4px', zIndex: 10 }}>
                        <button onClick={(e) => { e.stopPropagation(); onAddItem('activity', task.id); }} title="Adicionar Atividade" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                            <span className="material-icons" style={{ fontSize: '16px', color: '#10b981' }}>add</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onDeleteItem(task.id, 'task'); }} title="Excluir Tarefa" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                            <span className="material-icons" style={{ fontSize: '16px', color: '#ef4444' }}>remove</span>
                        </button>
                    </div>
                </td>
            )}

            {dynamicColumnsAfter.map((col, idx) => {
                const absIdx = dynamicColumnsBefore.length + 2 + idx;
                const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
                const value = group.customValues?.[col.id] || '';

                return (
                    <td 
                        key={col.id} 
                        className={`col-sticky col-sticky-${absIdx + 1}`} 
                        style={{ width: columnWidths[absIdx], left: stickyColumnPositions[absIdx], display: isVisible ? 'table-cell' : 'none' }} 
                        onClick={(e) => onRowClick(e, { id: group.id, name: value, type: 'group', wbsId: wbsId.split('.')[0] })}
                    >
                        <div contentEditable suppressContentEditableWarning onBlur={e => onTextUpdate(group.id, col.id, e.currentTarget.textContent || '')}>
                            {value}
                        </div>
                    </td>
                );
            })}
            
            <td className={`col-sticky col-sticky-${dynamicColumns.length + 3}`} style={{ width: columnWidths[dynamicColumns.length + 2], left: stickyColumnPositions[dynamicColumns.length + 2], display: visibleColumns && visibleColumns['ATIVIDADE'] === false ? 'none' : 'table-cell' }} onClick={(e) => activity && onRowClick(e, { id: activity.id, name: activity.name, type: 'activity', wbsId })}>
                 <div style={{ display: 'flex', alignItems: 'center' }}>
                     {activity && (
                         <span
                             className="drag-handle material-icons"
                             style={{ cursor: 'grab', marginRight: '4px', fontSize: '16px', color: '#cbd5e1' }}
                             draggable
                             onDragStart={(e) => {
                                 // Stop propagation to prevent group drag from triggering
                                 e.stopPropagation();
                                 onActivityDragStart(activity, task.id);
                             }}
                             onDragEnd={onDragEnd}
                         >
                             drag_indicator
                         </span>
                     )}
                     <div contentEditable={!!activity} suppressContentEditableWarning onBlur={e => activity && onTextUpdate(activity.id, 'atividade', e.currentTarget.textContent || '')} style={{ flexGrow: 1 }}>
                        {activity ? activity.name : <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>(Sem atividades)</span>}
                     </div>
                 </div>
                <div className="cell-actions" style={{ display: 'flex', gap: '4px', zIndex: 10 }}>
                    {activity && (
                        <>
                            <button onClick={(e) => { e.stopPropagation(); onMoveItem(activity.id, 'up'); }} title="Mover para Cima" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                <span className="material-icons" style={{ fontSize: '16px', color: '#64748b' }}>arrow_upward</span>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onMoveItem(activity.id, 'down'); }} title="Mover para Baixo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                                <span className="material-icons" style={{ fontSize: '16px', color: '#64748b' }}>arrow_downward</span>
                            </button>
                        </>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onAddItem('activity', task.id); }} title="Adicionar Atividade" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                        <span className="material-icons" style={{ fontSize: '18px', color: '#10b981' }}>add</span>
                    </button>
                    {activity && (
                        <button onClick={(e) => { e.stopPropagation(); onDeleteItem(activity.id, 'activity'); }} title="Excluir Atividade" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0', borderRadius: '4px', width: '24px', height: '24px', pointerEvents: 'auto' }}>
                            <span className="material-icons" style={{ fontSize: '16px', color: '#ef4444' }}>remove</span>
                        </button>
                    )}
                </div>
            </td>
            {dates.map(date => {
                const dateStr = formatDate(date);
                const isSelectedInBlock = activity ? isCellInBlock(activity.id, dateStr, selectionBlock) : false;
                return (
                    <ScheduleCell
                        key={dateStr}
                        date={date}
                        activity={activity}
                        isActive={activity ? activeCell?.activityId === activity.id && activeCell.date === dateStr : false}
                        isSelected={isSelectedInBlock}
                        isCut={activity ? isCellInBlock(activity.id, dateStr, cutSelectionBlock) : false}
                        isMoving={isMovingBlock && isSelectedInBlock}
                        isGhost={activity ? ghostBlockCells.has(`${activity.id}-${dateStr}`) : false}
                        onMouseDown={onCellMouseDown}
                        onMouseEnter={onCellMouseEnter}
                        onRightClick={onCellRightClick}
                    />
                );
            })}
        </tr>
    );
});

ScheduleRow.displayName = 'ScheduleRow';

// --- Schedule Header Component ---
interface ScheduleHeaderProps {
    dates: Date[];
    dynamicColumns: DynamicColumn[];
    columnWidths: number[];
    onResizeStart: (columnIndex: number, e: React.MouseEvent) => void;
    stickyColumnPositions: number[];
    onOpenFilter: (column: string, rect: DOMRect) => void;
    activeFilters: Record<string, Set<string>>;
    visibleColumns?: Record<string, boolean>;
    onColumnNameUpdate: (colId: string, name: string) => void;
    onAddColumn: (position?: 'before' | 'after') => void;
    onRemoveColumn: (colId: string) => void;
    onMoveColumn: (colId: string, direction: 'left' | 'right') => void;
}

export const ScheduleHeader: React.FC<ScheduleHeaderProps> = ({ 
    dates, dynamicColumns, columnWidths, onResizeStart, stickyColumnPositions, 
    onOpenFilter, activeFilters, visibleColumns,
    onColumnNameUpdate, onAddColumn, onRemoveColumn, onMoveColumn
}) => {
    
    const dynamicColumnsBefore = useMemo(() => dynamicColumns.filter(c => c.position !== 'after'), [dynamicColumns]);
    const dynamicColumnsAfter = useMemo(() => dynamicColumns.filter(c => c.position === 'after'), [dynamicColumns]);

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
        <thead>
            <tr>
                <th
                    rowSpan={3}
                    style={{ width: columnWidths[0], left: stickyColumnPositions[0], display: visibleColumns && visibleColumns['ID'] === false ? 'none' : 'table-cell' }}
                    className="col-sticky col-sticky-1"
                >
                    <div className="header-content">
                        <span>ID</span>
                        <div className="col-header-actions">
                            <button onClick={() => onAddColumn('before')} title="Adicionar Coluna Antes" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                        </div>
                    </div>
                    <div className="resize-handle" onMouseDown={(e) => onResizeStart(0, e)}></div>
                </th>

                {dynamicColumnsBefore.map((col, idx) => {
                    const absIdx = idx + 1;
                    const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
                    return (
                        <th
                            key={col.id}
                            rowSpan={3}
                            style={{ width: columnWidths[absIdx], left: stickyColumnPositions[absIdx], display: isVisible ? 'table-cell' : 'none' }}
                            className={`col-sticky col-sticky-${absIdx + 1}`}
                        >
                            <div className="header-content">
                                <input
                                    className="column-name-input"
                                    value={col.name || ''}
                                    onChange={(e) => onColumnNameUpdate(col.id, e.target.value)}
                                    title="Clique para renomear"
                                />
                                <div className="col-header-actions">
                                    <button onClick={() => onMoveColumn(col.id, 'left')} title="Mover para esquerda"><i className="material-icons">chevron_left</i></button>
                                    <button onClick={() => onMoveColumn(col.id, 'right')} title="Mover para direita"><i className="material-icons">chevron_right</i></button>
                                    <button onClick={() => onRemoveColumn(col.id)} title="Excluir Coluna" style={{ color: '#ef4444' }}><i className="material-icons">delete</i></button>
                                    <button onClick={() => onAddColumn('before')} title="Adicionar Coluna Antes" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                                </div>
                                <button
                                    className={`filter-icon-button ${activeFilters[col.id]?.size > 0 ? 'active' : ''}`}
                                    onClick={(e) => onOpenFilter(col.id, e.currentTarget.getBoundingClientRect())}
                                    aria-label={`Filtrar ${col.name}`}
                                >
                                    <span className="material-icons">filter_list</span>
                                </button>
                            </div>
                            <div className="resize-handle" onMouseDown={(e) => onResizeStart(absIdx, e)}></div>
                        </th>
                    );
                })}

                <th
                    rowSpan={3}
                    style={{ width: columnWidths[dynamicColumnsBefore.length + 1], left: stickyColumnPositions[dynamicColumnsBefore.length + 1], display: visibleColumns && visibleColumns['TAREFA PRINCIPAL'] === false ? 'none' : 'table-cell' }}
                    className={`col-sticky col-sticky-${dynamicColumnsBefore.length + 2}`}
                >
                    <div className="header-content">
                        <span>TAREFA PRINCIPAL</span>
                        <div className="col-header-actions">
                           <button onClick={() => onAddColumn('before')} title="Adicionar Coluna Antes" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                           <button onClick={() => onAddColumn('after')} title="Adicionar Coluna Depois" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                        </div>
                        <button
                            className={`filter-icon-button ${activeFilters['tarefaPrincipal']?.size > 0 ? 'active' : ''}`}
                            onClick={(e) => onOpenFilter('tarefaPrincipal', e.currentTarget.getBoundingClientRect())}
                            aria-label="Filtrar Tarefa Principal"
                        >
                            <span className="material-icons">filter_list</span>
                        </button>
                    </div>
                    <div className="resize-handle" onMouseDown={(e) => onResizeStart(dynamicColumnsBefore.length + 1, e)}></div>
                </th>

                {dynamicColumnsAfter.map((col, idx) => {
                    const absIdx = dynamicColumnsBefore.length + 2 + idx;
                    const isVisible = visibleColumns ? visibleColumns[col.name] !== false : true;
                    return (
                        <th
                            key={col.id}
                            rowSpan={3}
                            style={{ width: columnWidths[absIdx], left: stickyColumnPositions[absIdx], display: isVisible ? 'table-cell' : 'none' }}
                            className={`col-sticky col-sticky-${absIdx + 1}`}
                        >
                            <div className="header-content">
                                <input
                                    className="column-name-input"
                                    value={col.name || ''}
                                    onChange={(e) => onColumnNameUpdate(col.id, e.target.value)}
                                    title="Clique para renomear"
                                />
                                <div className="col-header-actions">
                                    <button onClick={() => onMoveColumn(col.id, 'left')} title="Mover para esquerda"><i className="material-icons">chevron_left</i></button>
                                    <button onClick={() => onMoveColumn(col.id, 'right')} title="Mover para direita"><i className="material-icons">chevron_right</i></button>
                                    <button onClick={() => onRemoveColumn(col.id)} title="Excluir Coluna" style={{ color: '#ef4444' }}><i className="material-icons">delete</i></button>
                                    <button onClick={() => onAddColumn('after')} title="Adicionar Coluna Depois" style={{ color: '#10b981' }}><i className="material-icons">add</i></button>
                                </div>
                                <button
                                    className={`filter-icon-button ${activeFilters[col.id]?.size > 0 ? 'active' : ''}`}
                                    onClick={(e) => onOpenFilter(col.id, e.currentTarget.getBoundingClientRect())}
                                    aria-label={`Filtrar ${col.name}`}
                                >
                                    <span className="material-icons">filter_list</span>
                                </button>
                            </div>
                            <div className="resize-handle" onMouseDown={(e) => onResizeStart(absIdx, e)}></div>
                        </th>
                    );
                })}

                <th
                    rowSpan={3}
                    style={{ width: columnWidths[dynamicColumns.length + 2], left: stickyColumnPositions[dynamicColumns.length + 2], display: visibleColumns && visibleColumns['ATIVIDADE'] === false ? 'none' : 'table-cell' }}
                    className={`col-sticky col-sticky-${dynamicColumns.length + 3}`}
                >
                    <div className="header-content">
                        <span>ATIVIDADE</span>
                        <button
                            className={`filter-icon-button ${activeFilters['atividade']?.size > 0 ? 'active' : ''}`}
                            onClick={(e) => onOpenFilter('atividade', e.currentTarget.getBoundingClientRect())}
                            aria-label="Filtrar Atividade"
                        >
                            <span className="material-icons">filter_list</span>
                        </button>
                    </div>
                    <div className="resize-handle" onMouseDown={(e) => onResizeStart(dynamicColumns.length + 2, e)}></div>
                </th>

                {weekSpans.map(span => (
                    <th key={`week-${span.week}`} colSpan={span.count} className="week-header">
                        Semana {span.week}
                    </th>
                ))}
            </tr>
            <tr>
                {dates.map(date => {
                    const dayAbbr = getDayAbbr(date);
                    const isWeekend = dayAbbr === 'SÁB' || dayAbbr === 'DOM';
                    const weekendClass = isWeekend ? 'saturday-col' : '';
                    return <th key={`day-${formatDate(date)}`} className={weekendClass}>{dayAbbr}</th>
                })}
            </tr>
            <tr>
                {dates.map(date => {
                    const dayAbbr = getDayAbbr(date);
                    const isWeekend = dayAbbr === 'SÁB' || dayAbbr === 'DOM';
                    const weekendClass = isWeekend ? 'saturday-col' : '';
                    return <th key={`date-${formatDate(date)}`} className={weekendClass}>{date.getUTCDate()}</th>
                })}
            </tr>
        </thead>
    );
};

// --- Schedule Body Component ---
interface ScheduleBodyProps {
    renderableRows: RenderableRow[];
    dates: Date[];
    dynamicColumns: DynamicColumn[];
    columnWidths: number[];
    stickyColumnPositions: number[];
    selectedItems: SelectedItem[];
    onRowClick: (event: React.MouseEvent, item: SelectedItem) => void;
    activeCell: { activityId: string; date: string; } | null;
    onCellMouseDown: (event: React.MouseEvent, activityId: string, date: string) => void;
    onCellMouseEnter: (activityId: string, date: string) => void;
    onCellRightClick: (event: React.MouseEvent, activityId: string, date: string) => void;
    selectionBlock: { anchor: { activityId: string; date: string; }; end: { activityId: string; date: string; }; } | null;
    cutSelectionBlock: { anchor: { activityId: string; date: string; }; end: { activityId: string; date: string; }; } | null;
    isMovingBlock: boolean;
    ghostBlockCells: Set<string>;
    onTextUpdate: (id: string, field: string, value: string) => void;
    onAddItem: (type: 'group' | 'task' | 'activity', parentId?: string) => void;
    onDeleteItem: (id: string, type: 'group' | 'task' | 'activity') => void;
    onMoveItem: (id: string, direction: 'up' | 'down') => void;
    draggedGroupInfo: { group: Grupo, index: number } | null;
    draggedActivityInfo: { activity: Atividade, taskId: string } | null;
    onGroupDragStart: (group: Grupo, index: number) => void;
    onGroupDrop: () => void;
    onActivityDragStart: (activity: Atividade, taskId: string) => void;
    onActivityDrop: (targetTaskId: string, targetActivityId: string | null) => void;
    onDragEnd: () => void;
    onDropTargetChange: (id: string | null) => void;
    dropTargetId: string | null;
}

export const ScheduleBody: React.FC<ScheduleBodyProps> = (props) => {
    const { 
        renderableRows, dates, dynamicColumns, columnWidths, stickyColumnPositions, 
        selectedItems, onRowClick, activeCell, onCellMouseDown, onCellMouseEnter, onCellRightClick,
        selectionBlock, cutSelectionBlock, isMovingBlock, ghostBlockCells,
        onTextUpdate, onAddItem, onDeleteItem, onMoveItem,
        draggedGroupInfo, draggedActivityInfo, onGroupDragStart, onGroupDrop, 
        onActivityDragStart, onActivityDrop,
        onDragEnd, onDropTargetChange, dropTargetId,
        visibleColumns
    } = props;

    const activityIdToRowIndex = useMemo(() => {
       const map = new Map<string, number>();
       renderableRows.forEach((r, i) => {
           if (r.activity) map.set(r.activity.id, i);
       });
       return map;
    }, [renderableRows]);
    const dateToColIndex = useMemo(() => new Map(dates.map((d, i) => [formatDate(d), i])), [dates]);
    
    const isCellInBlock = useCallback((activityId: string, dateStr: string, block: typeof selectionBlock) => {
        if (!block) return false;
        
        const currentRow = activityIdToRowIndex.get(activityId);
        const currentCol = dateToColIndex.get(dateStr);
        if (currentRow === undefined || currentCol === undefined) return false;
        
        const anchorRow = activityIdToRowIndex.get(block.anchor.activityId);
        const anchorCol = dateToColIndex.get(block.anchor.date);
        const endRow = activityIdToRowIndex.get(block.end.activityId);
        const endCol = dateToColIndex.get(block.end.date);
        if (anchorRow === undefined || anchorCol === undefined || endRow === undefined || endCol === undefined) return false;
        
        const minRow = Math.min(anchorRow, endRow);
        const maxRow = Math.max(anchorRow, endRow);
        const minCol = Math.min(anchorCol, endCol);
        const maxCol = Math.max(anchorCol, endCol);

        return currentRow >= minRow && currentRow <= maxRow && currentCol >= minCol && currentCol <= maxCol;
    }, [activityIdToRowIndex, dateToColIndex]);

    return (
        <tbody onMouseUp={onGroupDrop}>
             {renderableRows.map((row, index) => (
                <ScheduleRow
                    key={row.activity?.id || `empty-${row.task.id}-${index}`}
                    index={index}
                    row={row}
                    dates={dates}
                    dynamicColumns={dynamicColumns}
                    columnWidths={columnWidths}
                    stickyColumnPositions={stickyColumnPositions}
                    visibleColumns={visibleColumns}
                    selectedItems={selectedItems}
                    draggedGroupInfo={draggedGroupInfo}
                    draggedActivityInfo={draggedActivityInfo}
                    dropTargetId={dropTargetId}
                    activeCell={activeCell}
                    selectionBlock={selectionBlock}
                    cutSelectionBlock={cutSelectionBlock}
                    isMovingBlock={isMovingBlock}
                    ghostBlockCells={ghostBlockCells}
                    onRowClick={onRowClick}
                    onGroupDragStart={onGroupDragStart}
                    onActivityDragStart={onActivityDragStart}
                    onActivityDrop={onActivityDrop}
                    onDragEnd={onDragEnd}
                    onDropTargetChange={onDropTargetChange}
                    onAddItem={onAddItem}
                    onDeleteItem={onDeleteItem}
                    onMoveItem={onMoveItem}
                    onTextUpdate={onTextUpdate}
                    onCellMouseDown={onCellMouseDown}
                    onCellMouseEnter={onCellMouseEnter}
                    onCellRightClick={onCellRightClick}
                    isCellInBlock={isCellInBlock}
                />
            ))}
            <tr className="add-group-row" onDragOver={(e) => { e.preventDefault(); onDropTargetChange(null); }}>
                <td colSpan={columnWidths.length + dates.length} className={`add-group-cell ${dropTargetId === null ? 'drop-target-end' : ''}`}>
                    <button className="add-group-button" onClick={() => onAddItem('group')}>
                        <span className="material-icons">add</span> Adicionar Novo Grupo (Fase/FA)
                    </button>
                </td>
            </tr>
        </tbody>
    );
};
