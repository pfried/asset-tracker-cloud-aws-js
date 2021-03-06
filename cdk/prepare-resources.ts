import { IoTClient } from '@aws-sdk/client-iot'
import * as path from 'path'
import { promises as fs } from 'fs'
import { getLambdaSourceCodeBucketName } from './helper/getLambdaSourceCodeBucketName'
import {
	LayeredLambdas,
	packBaseLayer,
	packLayeredLambdas,
	WebpackMode,
} from '@nordicsemiconductor/package-layered-lambdas'
import { supportedRegions } from './regions'
import * as chalk from 'chalk'
import { getIotEndpoint } from './helper/getIotEndpoint'
import { spawn } from 'child_process'
import { ConsoleProgressReporter } from '@nordicsemiconductor/package-layered-lambdas/dist/src/reporter'

export type CDKLambdas = {
	createThingGroup: string
}

export type AssetTrackerLambdas = {
	storeMessagesInTimestream: string
	geolocateCellHttpApi: string
	invokeStepFunctionFromSQS: string
	geolocateCellFromCacheStepFunction: string
	geolocateCellFromDeviceLocationsStepFunction: string
	geolocateCellFromUnwiredLabsStepFunction: string
	cacheCellGeolocationStepFunction: string
	addCellGeolocationHttpApi: string
}

export const prepareResources = async ({
	rootDir,
}: {
	rootDir: string
}): Promise<{
	mqttEndpoint: string
	outDir: string
	sourceCodeBucketName: string
}> => {
	// Detect the AWS IoT endpoint
	const endpointAddress = await getIotEndpoint(new IoTClient({}))

	if (!supportedRegions.includes(process.env.AWS_REGION ?? 'us-east-1')) {
		console.log(
			chalk.yellow.inverse.bold(' WARNING '),
			chalk.yellow(
				`Your region ${
					process.env.AWS_REGION ?? 'us-east-1'
				} from the environment variable AWS_REGION is not in the list of supported regions!`,
			),
		)
		console.log(
			chalk.yellow.inverse.bold(' WARNING '),
			chalk.yellow(`CDK might not be able to successfully deploy.`),
		)
	}

	// Storeage for packed lambdas
	const outDir = path.resolve(rootDir, 'dist', 'lambdas')
	try {
		await fs.stat(outDir)
	} catch (_) {
		await fs.mkdir(outDir)
	}

	return {
		mqttEndpoint: endpointAddress,
		sourceCodeBucketName: await getLambdaSourceCodeBucketName(),
		outDir,
	}
}

export type PackedLambdas<
	A extends {
		[key: string]: string
	}
> = {
	lambdas: LayeredLambdas<A>
	layerZipFileName: string
}

export const prepareCDKLambdas = async ({
	rootDir,
	outDir,
	sourceCodeBucketName,
}: {
	rootDir: string
	outDir: string
	sourceCodeBucketName: string
}): Promise<PackedLambdas<CDKLambdas>> => {
	const reporter = ConsoleProgressReporter('CDK Lambdas')
	return {
		layerZipFileName: await (async () => {
			reporter.progress('base-layer')('Writing package.json')
			const cloudFormationLayerDir = path.resolve(
				rootDir,
				'dist',
				'lambdas',
				'cloudFormationLayer',
			)
			try {
				await fs.stat(cloudFormationLayerDir)
			} catch (_) {
				await fs.mkdir(cloudFormationLayerDir)
			}
			const { dependencies } = JSON.parse(
				await fs.readFile(path.resolve(rootDir, 'package.json'), 'utf-8'),
			)
			const cdkLambdaDeps = {
				'@aws-sdk/client-iot': dependencies['@aws-sdk/client-iot'],
				'@nordicsemiconductor/cloudformation-helpers':
					dependencies['@nordicsemiconductor/cloudformation-helpers'],
			}
			if (
				Object.values(cdkLambdaDeps).find((v) => v === undefined) !== undefined
			) {
				throw new Error(
					`Could not resolve all dependencies in "${JSON.stringify(
						cdkLambdaDeps,
					)}"`!,
				)
			}
			await fs.writeFile(
				path.join(cloudFormationLayerDir, 'package.json'),
				JSON.stringify({
					dependencies: cdkLambdaDeps,
				}),
				'utf-8',
			)
			reporter.progress('base-layer')('Installing dependencies')
			await new Promise<void>((resolve, reject) => {
				const p = spawn('npm', ['i', '--ignore-scripts', '--only=prod'], {
					cwd: cloudFormationLayerDir,
				})
				p.on('close', (code) => {
					if (code !== 0) {
						const msg = `[CloudFormation Layer] npm i in ${cloudFormationLayerDir} exited with code ${code}.`
						return reject(new Error(msg))
					}
					return resolve()
				})
			})
			return await packBaseLayer({
				reporter,
				srcDir: cloudFormationLayerDir,
				outDir,
				Bucket: sourceCodeBucketName,
			})
		})(),
		lambdas: await packLayeredLambdas<CDKLambdas>({
			reporter,
			id: 'CDK',
			mode: WebpackMode.production,
			srcDir: rootDir,
			outDir,
			Bucket: sourceCodeBucketName,
			lambdas: {
				createThingGroup: path.resolve(rootDir, 'cdk', 'createThingGroup.ts'),
			},
			tsConfig: path.resolve(rootDir, 'tsconfig.json'),
		}),
	}
}

export const prepareAssetTrackerLambdas = async ({
	rootDir,
	outDir,
	sourceCodeBucketName,
}: {
	rootDir: string
	outDir: string
	sourceCodeBucketName: string
}): Promise<PackedLambdas<AssetTrackerLambdas>> => {
	const reporter = ConsoleProgressReporter('Cat Tracker Lambdas')
	return {
		layerZipFileName: await packBaseLayer({
			reporter,
			srcDir: rootDir,
			outDir,
			Bucket: sourceCodeBucketName,
		}),
		lambdas: await packLayeredLambdas<AssetTrackerLambdas>({
			reporter,
			id: 'asset-tracker',
			mode: WebpackMode.production,
			srcDir: rootDir,
			outDir,
			Bucket: sourceCodeBucketName,
			lambdas: {
				storeMessagesInTimestream: path.resolve(
					rootDir,
					'historicalData',
					'storeMessagesInTimestream.ts',
				),
				invokeStepFunctionFromSQS: path.resolve(
					rootDir,
					'cellGeolocation',
					'lambda',
					'invokeStepFunctionFromSQS.ts',
				),
				geolocateCellFromCacheStepFunction: path.resolve(
					rootDir,
					'cellGeolocation',
					'stepFunction',
					'fromCache.ts',
				),
				geolocateCellFromDeviceLocationsStepFunction: path.resolve(
					rootDir,
					'cellGeolocation',
					'stepFunction',
					'fromDeviceLocations.ts',
				),
				geolocateCellFromUnwiredLabsStepFunction: path.resolve(
					rootDir,
					'cellGeolocation',
					'stepFunction',
					'unwiredlabs.ts',
				),
				cacheCellGeolocationStepFunction: path.resolve(
					rootDir,
					'cellGeolocation',
					'stepFunction',
					'updateCache.ts',
				),
				geolocateCellHttpApi: path.resolve(
					rootDir,
					'cellGeolocation',
					'httpApi',
					'cell.ts',
				),
				addCellGeolocationHttpApi: path.resolve(
					rootDir,
					'cellGeolocation',
					'httpApi',
					'addCellGeolocation.ts',
				),
			},
			tsConfig: path.resolve(rootDir, 'tsconfig.json'),
		}),
	}
}
