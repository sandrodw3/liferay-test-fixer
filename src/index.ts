import fs from 'node:fs'
import path from 'node:path'

import { buildExport } from '@/lib/build-export'
import { getRoutineResults } from '@/lib/get-routine-results'

async function main() {
	const routineIdArg = process.argv[2]

	if (!routineIdArg) {
		console.error('Usage: npm run collect -- <routineId>')

		process.exit(1)
	}

	const routineId = Number(routineIdArg)

	if (!Number.isInteger(routineId) || routineId <= 0) {
		console.error(`Invalid routine id: ${routineIdArg}`)
		process.exit(1)
	}

	const { results, build } = await getRoutineResults(routineId)

	const payload = buildExport(results, build)

	const date = new Date().toISOString().split('T')[0]

	const outputDir = path.join(process.cwd(), 'output')

	fs.mkdirSync(outputDir, { recursive: true })

	const outputPath = path.join(outputDir, `test-failures-${date}.json`)

	fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2))

	process.stdout.write(`${outputPath}\n`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
