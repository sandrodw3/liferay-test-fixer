export type Status = 'PASSED' | 'FAILED' | 'BLOCKED' | 'UNTESTED'

export type Routine = {
	id: number
}

export type Build = {
	dateCreated: string
	gitHash: string
	id: number
}

export type CaseResult = {
	id: number
	errors?: string
	r_caseToCaseResult_c_caseId: number
}

export type Case = {
	id: number
	name: string
	r_caseTypeToCases_c_caseTypeId: number
}

export type CaseType = {
	id: number
	name:
		| 'Playwright Test'
		| 'Modules Integration Test'
		| 'Modules Unit Test'
		| 'Modules Semantic Versioning Test'
		| 'Automated Functional Test'
		| 'JS Unit Test'
		| 'Batch'
}

export type History = Array<{
	gitHash: string
	status: Status
}>
