import type { MonitoringKind } from './monitoring-filter.mjs';
export type MatrixFilters = { yearId:string|null; periodId:string|null; testId:string|null; className:string|null; student:string|null; kind:MonitoringKind; merge:boolean; zone:'WIB'|'WITA'|'WIT'; from:string|null; to:string|null; fromUtc:string|null; toUtcExclusive:string|null };
export function parseMatrixFilters(p:URLSearchParams):{ok:true;filters:MatrixFilters;page:number}|{ok:false;error:string};
export function matrixSearchParams(f:MatrixFilters,page?:number):URLSearchParams;
