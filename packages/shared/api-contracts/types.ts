export type OesRole = 'ADMIN' | 'FACULTY' | 'STUDENT';
export type OesAttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'EVALUATED';
export type OesQuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_SELECT' | 'DESCRIPTIVE';
export interface AuthenticatedPrincipal { id: string; email: string; role: OesRole; }
export interface SaveAnswerRequest { selectedIds: string[]; textAnswer?: string; }
export interface StartAttemptRequest { acknowledge: boolean; }
