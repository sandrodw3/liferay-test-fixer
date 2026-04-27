import { TestResult } from '@/types/test-result'

type TypeName = TestResult['type']

export function getTypeLabel(typeName: TypeName) {
	if (typeName === 'Playwright Test') {
		return 'Playwright'
	} else if (typeName === 'Modules Integration Test') {
		return 'Java Integration'
	} else if (typeName === 'Modules Unit Test') {
		return 'Java Unit'
	} else if (typeName === 'Modules Semantic Versioning Test') {
		return 'Java Semantic Versioning'
	} else if (typeName === 'Automated Functional Test') {
		return 'Poshi'
	} else if (typeName === 'JS Unit Test') {
		return 'JavaScript'
	}

	return typeName
}

export function getTypeWeight(typeName: TypeName): number {
	const WEIGHTS = {
		'Playwright Test': 0,
		'JS Unit Test': 1,
		'Modules Integration Test': 2,
		'Java Log Assertor': 4,
		'Modules Unit Test': 3,
		'Modules Semantic Versioning Test': 5,
		'Automated Functional Test': 6,
		'Batch': 7,
	}

	return WEIGHTS[typeName] ?? 99
}
