export * from "./types";
export { ApiError } from "./request";
export { subscribeProgress } from "./progress";
export type { StoredLogLine, LogErrorInfo, LogLevel } from "./logs";
export type { EngineStatus, EngineCheck, CheckStatus, TtsEnginesInfo } from "./engine";
export type { CompareRun, CompareItem } from "./audio";
export type { Assessment, AssessmentKind, AssessmentStatus, StudyProgress, ExamSlot, ShiftPlan, StudyTimeInfo, ExamFocus } from "./plan";
export type { StudyImportReport, ImportCount, ModulePrefix, MaterialItem, MaterialKind, MaterialCounts, Trainer, TrainerCheck } from "./study";
import { libraryApi } from "./library";
import { learningApi } from "./learning";
import { settingsApi } from "./settings";
import { voicesApi } from "./voices";
import { audioApi } from "./audio";
import { logsApi } from "./logs";
import { engineApi } from "./engine";
import { studyApi } from "./study";
import { planApi } from "./plan";

export const api = {
  ...libraryApi,
  ...learningApi,
  ...settingsApi,
  ...voicesApi,
  ...audioApi,
  ...logsApi,
  ...engineApi,
  ...studyApi,
  ...planApi,
};
