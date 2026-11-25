export type MonitoringKind = 'regular' | 'makeup' | 'remedial';
export type MonitoringStatus = 'not_started' | 'working' | 'waiting' | 'submitted' | 'time_expired';
export type MonitoringOrder = 'time_desc' | 'time_asc' | 'score_desc' | 'score_asc' | 'student_asc' | 'student_desc' | 'test_asc' | 'test_desc';
export type MonitoringFilters = { yearId:string|null; testId:string|null; className:string|null; kind:MonitoringKind|null; status:MonitoringStatus|null; order:MonitoringOrder; zone:'WIB'|'WITA'|'WIT'; from:string|null; to:string|null; showAll:boolean; fromUtc:string|null; toUtcExclusive:string|null };
export function parseMonitoringFilters(p:URLSearchParams): {ok:true;filters:MonitoringFilters;page:number;finalPage:number}|{ok:false;error:string};
export function monitoringSearchParams(f:MonitoringFilters,page?:number,finalPage?:number):URLSearchParams;
export function monitoringDayBounds(dateString:string,zone?:'WIB'|'WITA'|'WIT'): {fromUtc:string;toUtcExclusive:string}|null;
