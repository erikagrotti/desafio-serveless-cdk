import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import path = require('path');
import * as apigatewayv2_authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';

export class CdkCustomStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'TabCustomCDK', {
      tableName: 'tab_custom_cdk',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // IAM Role for Lambda
    const lambdaRole = new iam.Role(this, 'CustomCdkRoleLambda', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [table.tableArn],
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Scan',
        'dynamodb:Query',
        'dynamodb:BatchWriteItem',
      ],
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cognito-idp:*', 'cognito-identity:*'],
      resources: ['*'],
    }));

    // Add permissions for logging
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`],
    }));

    // Lambda Function
    const lambdaFunction = new lambda.Function(this, 'CustomLambdaCdk', {
      functionName: 'custom_lambda_cdk',
      runtime: lambda.Runtime.PYTHON_3_9, 
      code: lambda.Code.fromAsset('hello_world', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      handler: 'app.lambda_handler',
      role: lambdaRole,
      timeout: cdk.Duration.seconds(10),
      architecture: lambda.Architecture.X86_64,
      environment: {
        USER_POOL_ID: 'Your USER_POOL_ID',
        REGION: ' Your REGION',
        IDENTITY_POOL_ID: 'Your IDENTITY_POOL_ID'
      }
    });

    // Cognito User Pool
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'cognito-cdk-angular',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF,
      email: cognito.UserPoolEmail.withSES({
        fromEmail: 'Your e-mail',
        sesRegion: 'Your REGION',
      }),
    });

    // App Client com configurações OAuth
    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: userPool,
      authFlows: {
        adminUserPassword: true,
        custom: true,
        userPassword: true,
        userSrp: true,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
    
    oAuth: {
      flows: {
        authorizationCodeGrant: true, 
      },
      scopes: [
        cognito.OAuthScope.OPENID, 
        cognito.OAuthScope.EMAIL, 
        cognito.OAuthScope.PROFILE,
      ], 
      callbackUrls: ['https://example.com/callback'], 
    },
  });
    

     // Crie um JWT authorizer usando o User Pool
     const authorizer = new apigatewayv2_authorizers.HttpUserPoolAuthorizer('UserPoolAuthorizer', userPool, {
      userPoolClients: [userPoolClient],
    });

     // Cognito Identity Pool
     const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: 'CustomIdentityPool',
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    // Função IAM para usuários autenticados no Identity Pool
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'], 
      actions: ['*'],    
    }));

    // Atribua a função autenticada ao Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // Defina o IDENTITY_POOL_ID na função Lambda
    lambdaFunction.addEnvironment('IDENTITY_POOL_ID', identityPool.ref);
    
     // HTTP API Gateway
     const httpApi = new apigateway.HttpApi(this, 'CustomHttpApiCdk', {
      apiName: 'CustomHttpApiCdk',
      corsPreflight: {
        allowHeaders: ['*'],
        allowMethods: [apigateway.CorsHttpMethod.ANY],
        allowOrigins: ['*'],
        maxAge: cdk.Duration.days(10),
      },
    });

    // Lambda Integration
    const lambdaIntegration = new integrations.HttpLambdaIntegration('LambdaIntegration', lambdaFunction);

    // API Routes
    const routes = [
      { path: '/items', method: apigateway.HttpMethod.POST },       
      { path: '/items', method: apigateway.HttpMethod.GET },        
      { path: '/items/{listID}', method: apigateway.HttpMethod.GET },
      { path: '/items/{listID}', method: apigateway.HttpMethod.PATCH }, 
      { path: '/items/{listID}/status', method: apigateway.HttpMethod.PATCH }, 
      { path: '/items/{listID}/{taskID}/status', method: apigateway.HttpMethod.PATCH },
      { path: '/items/{listID}', method: apigateway.HttpMethod.DELETE }, 
      {path: '/items/{listID}/{taskID}', method: apigateway.HttpMethod.DELETE} 
    ];
    
    routes.forEach(route => {
      httpApi.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: lambdaIntegration,
        authorizer: authorizer 
      });
    });

     
    // Outputs
    new cdk.CfnOutput(this, 'CustomApi', {
      value: httpApi.apiEndpoint,
      description: 'API Gateway endpoint URL for the  function',
    });

    new cdk.CfnOutput(this, 'CustomFunctionArn', {
      value: lambdaFunction.functionArn,
      description: 'Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'CustomFunctionIamRole', {
      value: lambdaRole.roleArn,
      description: 'Implicit IAM Role created for the function',
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', { 
      value: identityPool.ref,
      description: 'Identity Pool ID',
    }); 

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'User Pool Client ID',
    });

    
  }
}
  
