import { TestrayClient } from '@/lib/testray-client'

import { Build, Routine } from '@/types/testray'

export async function getRoutineBuilds({
	routineId,
	limit,
}: {
	routineId: Routine['id']
	limit?: number
}) {
	return await TestrayClient.get<Build[]>({
		url: 'https://testray.liferay.com/o/c/builds/',
		params: {
			filter: `r_routineToBuilds_c_routineId eq '${routineId}'`,
			pageSize: limit,
			sort: 'dateCreated:desc',
		},
	})
}
