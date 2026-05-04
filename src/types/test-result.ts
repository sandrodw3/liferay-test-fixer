import { CaseType, Status } from './testray'

export type TestResult = {
	name: string
	errorTrace?: string
	history: Array<{ gitHash: string; status: Status }> | null
	type: CaseType['name'] | 'Java Log Assertor'
}
