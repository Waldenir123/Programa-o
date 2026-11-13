import React, { useMemo, useState, useEffect } from 'react';
import { ScheduleData, Status, STATUS_LABELS, STATUS_BADGE_CLASSES } from '../state/types';
import { formatDate, cleanText } from '../utils/dataUtils';

interface DailySummaryViewProps {
    data: ScheduleData;
    dates: Date[];
    onTextUpdate: (id: string, field: string, value: string) => void;
    onAddItem: (type: 'group' | 'task' | 'activity', parentId?: string, date?: string) => void;
    onDeleteItem: (id: string, type: 'group' | 'task' | 'activity') => void;
    onSyncWithSchedule: () => void;
}

export const DailySummaryView: React.FC<DailySummaryViewProps> = ({ data, dates, onTextUpdate, onAddItem, onDeleteItem, onSyncWithSchedule }) => {
    const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'next4weeks'>('daily');
    const todayStr = formatDate(new Date());
    const initialDate = dates.find(d => formatDate(d) === todayStr) ? todayStr : (dates.length > 0 ? formatDate(dates[0]) : todayStr);
    const [selectedDateStr, setSelectedDateStr] = useState<string>(initialDate);
    
    useEffect(() => {
        if (!dates.some(d => formatDate(d) === selectedDateStr)) {
            setSelectedDateStr(dates.find(d => formatDate(d) === todayStr) ? todayStr : (dates.length > 0 ? formatDate(dates[0]) : todayStr));
        }
    }, [dates, selectedDateStr, todayStr]);
    
    // Weekly/Period state
    const [customStart, setCustomStart] = useState<string>('');
    const [customEnd, setCustomEnd] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [selectedStatus, setSelectedStatus] = useState<string>('');

    useEffect(() => {
        if (dates.length > 0) {
            if (!customStart) setCustomStart(formatDate(dates[0]));
            if (!customEnd) setCustomEnd(formatDate(dates[Math.min(dates.length - 1, 6)]));
        }
    }, [dates, customStart, customEnd]);

    const categorizeActivity = (name: string): string => {
        const lowerName = name.toLowerCase();
        if (/(usinagem|ferramentaria|corpo de prova|corpos de prova|fresagem|fresa|torno\b|mandrilhamento)/.test(lowerName)) {
            return "Usinagem/Ferramentaria";
        }
        if (/(inspeção|inspecao|vt\b|lp\b|dt\b|ut\b|rx\b|ensaio|ultrassom|radiografia|líquido penetrante|partícula magnética)/.test(lowerName)) {
            return "Inspeções (VT, LP, DT, UT, e RX e ensaios)";
        }
        if (/(solda|soldagem|tt\b|tratamento térmico|alívio de tensão|alivio)/.test(lowerName)) {
            return "Soldagem e Tratamento Térmico";
        }
        if (/(montagem|caldeiraria|acoplamento|ponteamento|ajuste)/.test(lowerName)) {
            return "Montagem e Caldeiraria";
        }
        if (/(corte|traçagem|tracagem|plasma|oxicorte|bisel|chanfro)/.test(lowerName)) {
            return "Setor de Traçagem e Corte";
        }
        return "Outras Atividades";
    };

    const resolveGroupMeta = (customValues?: Record<string, string>) => {
        if (customValues?.['grupo']?.trim()) {
            const val = customValues['grupo'].trim();
            return {
                label: val.toLowerCase() === 'grupo sem nome' ? 'Sem Agrupador Definido' : val,
                fieldKey: 'grupo',
            };
        }
        if (customValues?.['fa']?.trim()) {
            const val = customValues['fa'].trim();
            return {
                label: val.toLowerCase() === 'grupo sem nome' ? 'Sem Agrupador Definido' : val,
                fieldKey: 'fa',
            };
        }
        const firstEntry = Object.entries(customValues || {}).find(([, v]) => v && v.trim() !== '');
        if (firstEntry) {
            const val = firstEntry[1].trim();
            return {
                label: val.toLowerCase() === 'grupo sem nome' ? 'Sem Agrupador Definido' : val,
                fieldKey: firstEntry[0],
            };
        }
        return {
            label: 'Sem Agrupador Definido',
            fieldKey: 'fa',
        };
    };

    const dailySummary = useMemo(() => {
        const categories: Record<string, { groupId: string; groupTitle: string; groupFieldKey: string; taskId: string; taskTitle: string; taskFa: string; activities: { id: string; name: string; status: Status }[] }[]> = {
            "Setor de Traçagem e Corte": [],
            "Inspeções (VT, LP, DT, UT, e RX e ensaios)": [],
            "Soldagem e Tratamento Térmico": [],
            "Montagem e Caldeiraria": [],
            "Usinagem/Ferramentaria": [],
            "Outras Atividades": []
        };

        const term = searchQuery.trim().toLowerCase();

        (data || []).forEach(group => {
            const { label: groupTitle, fieldKey: groupFieldKey } = resolveGroupMeta(group.customValues);
            (group.tarefas || []).forEach(task => {
                (task.activities || []).forEach(a => {
                    const status = a.schedule[selectedDateStr];
                    if (status !== null && status !== undefined) {
                        if (selectedStatus && status !== selectedStatus) {
                            return;
                        }
                        if (
                            term &&
                            !a.name.toLowerCase().includes(term) &&
                            !groupTitle.toLowerCase().includes(term) &&
                            !task.title.toLowerCase().includes(term) &&
                            !(task.fa || '').toLowerCase().includes(term)
                        ) {
                            return;
                        }
                        const catKey = a.sector || categorizeActivity(a.name);

                        if (!categories[catKey]) {
                            categories[catKey] = [];
                        }

                        let taskEntry = categories[catKey].find(t => t.taskId === task.id);
                        if (!taskEntry) {
                            taskEntry = {
                                groupId: group.id,
                                groupTitle,
                                groupFieldKey,
                                taskId: task.id,
                                taskTitle: task.title,
                                taskFa: task.fa || '',
                                activities: []
                            };
                            categories[catKey].push(taskEntry);
                        }

                        taskEntry.activities.push({
                            id: a.id,
                            name: a.name,
                            status: status as Status
                        });
                    }
                });
            });
        });

        return Object.entries(categories)
            .filter(([_, tasks]) => tasks.length > 0)
            .filter(([category, _]) => selectedCategory ? category === selectedCategory : true)
            .map(([category, tasks]) => ({ category, tasks }));
    }, [data, selectedDateStr, selectedCategory, selectedStatus, searchQuery]);

    const handleDragStart = (e: React.DragEvent, activityId: string) => {
        e.dataTransfer.setData('application/x-activity-id', activityId);
    };

    const handleDrop = (e: React.DragEvent, category: string) => {
        e.preventDefault();
        const activityId = e.dataTransfer.getData('application/x-activity-id');
        if (activityId) {
            onTextUpdate(activityId, 'sector', category);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const weeklySummaryByDay = useMemo(() => {
        const periodDates: string[] = [];

        if (viewMode === 'next4weeks') {
            const dStartIndex = dates.findIndex(d => formatDate(d) === todayStr) !== -1 ? dates.findIndex(d => formatDate(d) === todayStr) : 0;
            const end = Math.min(dStartIndex + 27, dates.length - 1);
            for (let i = dStartIndex; i <= end; i++) {
                periodDates.push(formatDate(dates[i]));
            }
        } else {
            if (!customStart || !customEnd) return [];

            const dStartIndex = dates.findIndex(d => formatDate(d) === customStart);
            const dEndIndex = dates.findIndex(d => formatDate(d) === customEnd);

            if (dStartIndex !== -1 && dEndIndex !== -1) {
                const start = Math.min(dStartIndex, dEndIndex);
                const end = Math.max(dStartIndex, dEndIndex);
                for (let i = start; i <= end; i++) {
                    periodDates.push(formatDate(dates[i]));
                }
            }
        }

        const result: { dateStr: string; dateObj: Date; categories: any[] }[] = [];
        const term = searchQuery.trim().toLowerCase();

        periodDates.forEach(dateStr => {
            const categories: Record<string, any[]> = {
                "Setor de Traçagem e Corte": [],
                "Inspeções (VT, LP, DT, UT, e RX e ensaios)": [],
                "Soldagem e Tratamento Térmico": [],
                "Montagem e Caldeiraria": [],
                "Usinagem/Ferramentaria": [],
                "Outras Atividades": []
            };

            (data || []).forEach(group => {
                const { label: groupTitle, fieldKey: groupFieldKey } = resolveGroupMeta(group.customValues);
                (group.tarefas || []).forEach(task => {
                    (task.activities || []).forEach(a => {
                        const status = a.schedule[dateStr];
                        if (status !== null && status !== undefined) {
                            if (viewMode === 'next4weeks' && status !== Status.Programado) {
                                return;
                            }
                            if (selectedStatus && status !== selectedStatus) {
                                return;
                            }
                            if (
                                term &&
                                !a.name.toLowerCase().includes(term) &&
                                !groupTitle.toLowerCase().includes(term) &&
                                !task.title.toLowerCase().includes(term) &&
                                !(task.fa || '').toLowerCase().includes(term)
                            ) {
                                return;
                            }
                            const catKey = a.sector || categorizeActivity(a.name);
                            if (!categories[catKey]) {
                                categories[catKey] = [];
                            }

                            let taskEntry = categories[catKey].find((t: any) => t.taskId === task.id);
                            if (!taskEntry) {
                                taskEntry = {
                                    groupId: group.id,
                                    groupTitle,
                                    groupFieldKey,
                                    taskId: task.id,
                                    taskTitle: task.title,
                                    taskFa: task.fa || '',
                                    activities: []
                                };
                                categories[catKey].push(taskEntry);
                            }

                            taskEntry.activities.push({
                                id: a.id,
                                name: a.name,
                                status: status as Status
                            });
                        }
                    });
                });
            });

            const dayCategories = Object.entries(categories)
                .filter(([_, tasks]) => tasks.length > 0)
                .filter(([category, _]) => selectedCategory ? category === selectedCategory : true)
                .map(([category, tasks]) => ({ category, tasks }));

            if (dayCategories.length > 0 || (!searchQuery && !selectedCategory && !selectedStatus)) {
                result.push({
                    dateStr,
                    dateObj: new Date(dateStr + 'T00:00:00Z'),
                    categories: dayCategories
                });
            }
        });

        return result;
    }, [data, customStart, customEnd, searchQuery, dates, selectedCategory, selectedStatus, viewMode, todayStr]);

    const handlePrint = () => {
        window.print();
    };

    const handleExportWord = () => {
        import('../utils/exportAgents').then(module => {
            module.exportDailySummaryToWordAgent(
                viewMode,
                viewMode === 'daily' ? selectedDateStr : customStart,
                customEnd,
                searchQuery,
                viewMode === 'daily' ? dailySummary : weeklySummaryByDay
            );
        });
    };

    return (
        <div className="daily-summary-view h-full overflow-y-auto bg-slate-50 p-5 md:p-6">
            {/* Header Row */}
            <div className="no-print flex flex-wrap items-center justify-between gap-4 mb-4">
                <div className="flex flex-wrap items-center gap-4">
                    <h2 className="text-xl font-bold tracking-tight text-slate-900 m-0">Gestão de Atividades</h2>
                    <div className="inline-flex items-center bg-slate-200/80 p-1 rounded-lg">
                        <button
                            type="button"
                            onClick={() => setViewMode('daily')}
                            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer border-0 ${
                                viewMode === 'daily'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'bg-transparent text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Resumo Diário
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('weekly')}
                            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer border-0 ${
                                viewMode === 'weekly'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'bg-transparent text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Filtro Semanal
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('next4weeks')}
                            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer border-0 ${
                                viewMode === 'next4weeks'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'bg-transparent text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Próxim. 4 Semanas
                        </button>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => onAddItem('group', undefined, viewMode === 'daily' ? selectedDateStr : undefined)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer border-0"
                >
                    <span className="material-icons" style={{ fontSize: '17px' }}>add</span>
                    Adicionar Grupo
                </button>
            </div>

            {/* Unified Single Aligned Control Bar */}
            <div className="no-print bg-white border border-slate-200 rounded-xl px-4 py-3 mb-6 shadow-sm flex flex-wrap items-center justify-between gap-3">
                {/* Left: Filters */}
                <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
                    <div className="relative min-w-[200px] flex-1 max-w-[260px]">
                        <span
                            className="material-icons absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                            style={{ fontSize: '17px' }}
                        >
                            search
                        </span>
                        <input
                            type="text"
                            placeholder="Buscar atividade, FA ou grupo..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
                        />
                    </div>

                    <div className="flex items-center gap-1.5">
                        <label htmlFor="summary-sector" className="text-xs font-semibold text-slate-500">Setor:</label>
                        <select
                            id="summary-sector"
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                        >
                            <option value="">Todos</option>
                            <option value="Setor de Traçagem e Corte">Setor de Traçagem e Corte</option>
                            <option value="Inspeções (VT, LP, DT, UT, e RX e ensaios)">Inspeções</option>
                            <option value="Soldagem e Tratamento Térmico">Soldagem e Tratamento Térmico</option>
                            <option value="Montagem e Caldeiraria">Montagem e Caldeiraria</option>
                            <option value="Usinagem/Ferramentaria">Usinagem/Ferramentaria</option>
                            <option value="Outras Atividades">Outras Atividades</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <label htmlFor="summary-status" className="text-xs font-semibold text-slate-500">Status:</label>
                        <select
                            id="summary-status"
                            value={selectedStatus}
                            onChange={(e) => setSelectedStatus(e.target.value)}
                            className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:border-blue-500 focus:bg-white"
                        >
                            <option value="">Todos</option>
                            {Object.entries(STATUS_LABELS).map(([statusKey, label]) => (
                                <option key={statusKey} value={statusKey}>{label}</option>
                            ))}
                        </select>
                    </div>

                    {viewMode === 'daily' ? (
                        <div className="flex items-center gap-1.5">
                            <label htmlFor="summary-date" className="text-xs font-semibold text-slate-500">Data:</label>
                            <select
                                id="summary-date"
                                value={selectedDateStr}
                                onChange={(e) => setSelectedDateStr(e.target.value)}
                                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium tabular-nums focus:outline-none focus:border-blue-500 focus:bg-white"
                            >
                                {dates.map(d => (
                                    <option key={formatDate(d)} value={formatDate(d)}>
                                        {d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : viewMode === 'weekly' ? (
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                                <label htmlFor="summary-start" className="text-xs font-semibold text-slate-500">De:</label>
                                <select
                                    id="summary-start"
                                    value={customStart}
                                    onChange={(e) => setCustomStart(e.target.value)}
                                    className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium tabular-nums focus:outline-none focus:border-blue-500 focus:bg-white"
                                >
                                    {dates.map(d => (
                                        <option key={formatDate(d)} value={formatDate(d)}>
                                            {d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <label htmlFor="summary-end" className="text-xs font-semibold text-slate-500">Até:</label>
                                <select
                                    id="summary-end"
                                    value={customEnd}
                                    onChange={(e) => setCustomEnd(e.target.value)}
                                    className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium tabular-nums focus:outline-none focus:border-blue-500 focus:bg-white"
                                >
                                    {dates.map(d => (
                                        <option key={formatDate(d)} value={formatDate(d)}>
                                            {d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Right: Unified Action Buttons */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={onSyncWithSchedule}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                        title="Sincronizar com os dados atuais da aba Programação"
                    >
                        <span className="material-icons text-blue-600" style={{ fontSize: '16px' }}>sync</span>
                        Sincronizar
                    </button>
                    <button
                        type="button"
                        onClick={handleExportWord}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer border-0"
                    >
                        <span className="material-icons" style={{ fontSize: '16px' }}>description</span>
                        Exportar Word
                    </button>
                    <button
                        type="button"
                        onClick={handlePrint}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-slate-900 text-xs font-semibold transition-colors cursor-pointer border-0"
                    >
                        <span className="material-icons" style={{ fontSize: '16px' }}>print</span>
                        Imprimir
                    </button>
                </div>
            </div>

            {viewMode === 'daily' ? (
                <>
                    {dailySummary.length === 0 ? (
                        <div className="no-print bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
                            <span className="material-icons text-slate-300 mb-3" style={{ fontSize: '44px' }}>event_busy</span>
                            <p className="text-slate-500 text-sm font-medium m-0">Não há atividades programadas para este dia.</p>
                        </div>
                    ) : (
                        <div className="print-area flex flex-col gap-6">
                            <div className="print-only hidden mb-4">
                                <h1 className="text-xl font-bold text-center mb-1">
                                    Resumo Diário - {new Date(selectedDateStr + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                </h1>
                            </div>
                            {dailySummary.map(({ category, tasks }) => {
                                const totalActivities = tasks.reduce((acc, t) => acc + t.activities.length, 0);
                                return (
                                    <div
                                        key={category}
                                        style={{ pageBreakInside: 'avoid' }}
                                        className="rounded-xl transition-colors"
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, category)}
                                    >
                                        <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-4">
                                            <h3 className="text-base font-bold text-slate-800 tracking-tight m-0">{category}</h3>
                                            <span className="text-xs font-semibold text-slate-500 tabular-nums">
                                                {tasks.length} {tasks.length === 1 ? 'tarefa' : 'tarefas'} · {totalActivities} {totalActivities === 1 ? 'atividade' : 'atividades'}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {tasks.map((item, idx) => (
                                                <div
                                                    key={`${item.taskId}-${idx}`}
                                                    className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative group flex flex-col"
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => onDeleteItem(item.taskId, 'task')}
                                                        className="no-print absolute top-3 right-3 text-slate-400 hover:text-rose-600 bg-transparent border-0 p-1 rounded cursor-pointer transition-colors"
                                                        title="Excluir Tarefa"
                                                    >
                                                        <span className="material-icons" style={{ fontSize: '18px' }}>delete_outline</span>
                                                    </button>

                                                    <div className="mb-3 pb-2.5 border-b border-slate-100 pr-7">
                                                        <div
                                                            contentEditable
                                                            suppressContentEditableWarning
                                                            onBlur={e => onTextUpdate(item.groupId, item.groupFieldKey, e.currentTarget.textContent || '')}
                                                            className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide outline-none truncate"
                                                            title={item.groupTitle}
                                                            dangerouslySetInnerHTML={{ __html: cleanText(item.groupTitle) }}
                                                        />
                                                        <div className="flex flex-wrap items-baseline gap-1.5 mt-1">
                                                            <div
                                                                contentEditable
                                                                suppressContentEditableWarning
                                                                onBlur={e => onTextUpdate(item.taskId, 'tarefa', e.currentTarget.textContent || '')}
                                                                className="text-sm font-bold text-slate-900 outline-none leading-snug"
                                                                dangerouslySetInnerHTML={{ __html: cleanText(item.taskTitle) }}
                                                            />
                                                            <span className="text-slate-300 text-xs select-none">·</span>
                                                            <div
                                                                contentEditable
                                                                suppressContentEditableWarning
                                                                onBlur={e => onTextUpdate(item.taskId, 'tarefa_fa', e.currentTarget.textContent || '')}
                                                                className="text-xs font-medium text-slate-500 tabular-nums outline-none"
                                                                dangerouslySetInnerHTML={{ __html: cleanText(item.taskFa ? `${item.taskFa}` : 'Sem FA') }}
                                                            />
                                                        </div>
                                                    </div>

                                                    <ul className="list-none p-0 m-0 flex-1">
                                                        {item.activities.map((act, actIdx) => (
                                                            <li
                                                                key={act.id}
                                                                draggable
                                                                onDragStart={(e) => handleDragStart(e, act.id)}
                                                                className={`flex justify-between items-center py-2 cursor-grab ${
                                                                    actIdx < item.activities.length - 1 ? 'border-b border-dashed border-slate-200' : ''
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                                                    <span className="material-icons text-slate-300 shrink-0" style={{ fontSize: '16px' }}>drag_indicator</span>
                                                                    <div
                                                                        contentEditable
                                                                        suppressContentEditableWarning
                                                                        onBlur={e => onTextUpdate(act.id, 'atividade', e.currentTarget.textContent || '')}
                                                                        className="text-xs font-medium text-slate-700 flex-1 outline-none leading-snug"
                                                                        dangerouslySetInnerHTML={{ __html: cleanText(act.name) }}
                                                                    />
                                                                </div>
                                                                <span className={`ml-2.5 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${STATUS_BADGE_CLASSES[act.status]}`}>
                                                                    {STATUS_LABELS[act.status]}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>

                                                    <button
                                                        type="button"
                                                        onClick={() => onAddItem('activity', item.taskId, selectedDateStr)}
                                                        className="no-print w-full mt-3 py-1.5 bg-transparent border border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600 rounded-lg cursor-pointer text-slate-500 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                                                    >
                                                        <span className="material-icons" style={{ fontSize: '15px' }}>add</span>
                                                        Nova Atividade
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : (
                <>
                    {weeklySummaryByDay.every(day => day.categories.length === 0) ? (
                        <div className="no-print bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
                            <span className="material-icons text-slate-300 mb-3" style={{ fontSize: '44px' }}>search_off</span>
                            <p className="text-slate-500 text-sm font-medium m-0">
                                {searchQuery.trim() ? 'Nenhuma atividade encontrada com esse filtro no período.' : 'Nenhuma atividade agendada neste período.'}
                            </p>
                        </div>
                    ) : (
                        <div className="print-area flex flex-col gap-6">
                            <div className="print-only hidden mb-4">
                                <h1 className="text-xl font-bold text-center mb-1">
                                    Resumo Semanal
                                    {searchQuery.trim() ? ` - Filtro: "${searchQuery}"` : ''}
                                </h1>
                                <p className="text-center text-slate-500 text-xs">
                                    {new Date(customStart + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' })} até {new Date(customEnd + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                </p>
                            </div>
                            {weeklySummaryByDay.map((daySummary) => daySummary.categories.length > 0 && (
                                <div
                                    key={daySummary.dateStr}
                                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm"
                                    style={{ pageBreakInside: 'avoid' }}
                                >
                                    <h2 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-2.5 mb-4 m-0">
                                        {daySummary.dateObj.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC', day: '2-digit', month: '2-digit' }).replace(/^\w/, c => c.toUpperCase())}
                                    </h2>

                                    <div className="flex flex-col gap-5">
                                        {daySummary.categories.map(({ category, tasks }) => (
                                            <div key={category}>
                                                <h3 className="text-sm font-bold text-slate-700 mb-3 tracking-tight">{category}</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {tasks.map((item: any, idx: number) => (
                                                        <div
                                                            key={`${item.taskId}-${idx}`}
                                                            className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative group flex flex-col"
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => onDeleteItem(item.taskId, 'task')}
                                                                className="no-print absolute top-3 right-3 text-slate-400 hover:text-rose-600 bg-transparent border-0 p-1 rounded cursor-pointer transition-colors"
                                                                title="Excluir Tarefa"
                                                            >
                                                                <span className="material-icons" style={{ fontSize: '18px' }}>delete_outline</span>
                                                            </button>

                                                            <div className="mb-2.5 pb-2 border-b border-slate-200/80 pr-7">
                                                                <div
                                                                    contentEditable
                                                                    suppressContentEditableWarning
                                                                    onBlur={e => onTextUpdate(item.groupId, item.groupFieldKey || 'fa', e.currentTarget.textContent || '')}
                                                                    className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide outline-none truncate"
                                                                    title={item.groupTitle}
                                                                    dangerouslySetInnerHTML={{ __html: cleanText(item.groupTitle) }}
                                                                />
                                                                <div className="flex flex-wrap items-baseline gap-1.5 mt-1">
                                                                    <div
                                                                        contentEditable
                                                                        suppressContentEditableWarning
                                                                        onBlur={e => onTextUpdate(item.taskId, 'tarefa', e.currentTarget.textContent || '')}
                                                                        className="text-sm font-bold text-slate-900 outline-none leading-snug"
                                                                        dangerouslySetInnerHTML={{ __html: cleanText(item.taskTitle) }}
                                                                    />
                                                                    <span className="text-slate-300 text-xs select-none">·</span>
                                                                    <div
                                                                        contentEditable
                                                                        suppressContentEditableWarning
                                                                        onBlur={e => onTextUpdate(item.taskId, 'tarefa_fa', e.currentTarget.textContent || '')}
                                                                        className="text-xs font-medium text-slate-500 tabular-nums outline-none"
                                                                        dangerouslySetInnerHTML={{ __html: cleanText(item.taskFa ? `${item.taskFa}` : 'Sem FA') }}
                                                                    />
                                                                </div>
                                                            </div>

                                                            <ul className="list-none p-0 m-0 flex-1">
                                                                {item.activities.map((act: any, actIdx: number) => (
                                                                    <li
                                                                        key={act.id}
                                                                        className={`flex justify-between items-center py-1.5 ${
                                                                            actIdx < item.activities.length - 1 ? 'border-b border-dashed border-slate-200' : ''
                                                                        }`}
                                                                    >
                                                                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                                                            <span className="material-icons text-slate-400 shrink-0" style={{ fontSize: '15px' }}>chevron_right</span>
                                                                            <div
                                                                                contentEditable
                                                                                suppressContentEditableWarning
                                                                                onBlur={e => onTextUpdate(act.id, 'atividade', e.currentTarget.textContent || '')}
                                                                                className="text-xs font-medium text-slate-700 flex-1 outline-none leading-snug"
                                                                                dangerouslySetInnerHTML={{ __html: cleanText(act.name) }}
                                                                            />
                                                                        </div>
                                                                        <span className={`ml-2.5 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${STATUS_BADGE_CLASSES[act.status]}`}>
                                                                            {STATUS_LABELS[act.status]}
                                                                        </span>
                                                                    </li>
                                                                ))}
                                                            </ul>

                                                            <button
                                                                type="button"
                                                                onClick={() => onAddItem('activity', item.taskId, daySummary.dateStr)}
                                                                className="no-print w-full mt-3 py-1.5 bg-transparent border border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600 rounded-lg cursor-pointer text-slate-500 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                                                            >
                                                                <span className="material-icons" style={{ fontSize: '15px' }}>add</span>
                                                                Nova Atividade
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

