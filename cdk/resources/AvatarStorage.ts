import * as CloudFormation from '@aws-cdk/core'
import * as S3 from '@aws-cdk/aws-s3'
import * as IAM from '@aws-cdk/aws-iam'

/**
 * Storage for avatars
 */
export class AvatarStorage extends CloudFormation.Resource {
	public readonly bucket: S3.IBucket
	public constructor(
		parent: CloudFormation.Stack,
		id: string,
		{ userRole }: { userRole: IAM.Role },
	) {
		super(parent, id)

		this.bucket = new S3.Bucket(this, 'bucket', {
			publicReadAccess: true,
			cors: [
				{
					allowedHeaders: ['*'],
					allowedMethods: [S3.HttpMethods.GET, S3.HttpMethods.PUT],
					allowedOrigins: ['*'],
					exposedHeaders: ['Date'],
					maxAge: 3600,
				},
			],
			removalPolicy: CloudFormation.RemovalPolicy.DESTROY,
		})

		userRole.addToPolicy(
			new IAM.PolicyStatement({
				resources: [`${this.bucket.bucketArn}/*`],
				actions: ['s3:PutObject'],
			}),
		)
	}
}
