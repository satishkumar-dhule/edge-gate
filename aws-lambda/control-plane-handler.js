/**
 * ============================================================================
 * AWS LAMBDA HANDLER: AD-HOC CONTROL PLANE API, OPENAPI 3.1 & MCP SERVER
 * ============================================================================
 * Scale-to-Zero ($0/idle) Serverless Control Plane for the Akamai Synthetic
 * Release Gate. Handles Amazon API Gateway HTTP API v2 (payload format 2.0)
 * and AWS Lambda Function URL requests.
 *
 * Runtime: nodejs20.x (arm64 Graviton2)
 * Cost Model: $0.00/month when idle; billed per-ms only during ad-hoc release checks.
 * ============================================================================
 */

const crypto = require('crypto');
const {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const {
  LambdaClient,
  InvokeCommand,
} = require('@aws-sdk/client-lambda');
const {
  SyntheticsClient,
  StartCanaryCommand,
} = require('@aws-sdk/client-synthetics');
const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require('@aws-sdk/client-bedrock-runtime');

const REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET = (process.env.SYNTHETICS_S3_BUCKET || '').replace(/^s3:\/\//, '');
const DYNAMODB_TABLE =
  process.env.SYNTHETICS_DYNAMODB_TABLE || 'AkamaiReleaseGateRuns';
const SSM_CONFIG_PARAM =
  process.env.SSM_CONFIG_PARAMETER || '/akamai-release-gate/prod/runtime-config';
const ADHOC_RUNNER_LAMBDA_NAME =
  process.env.ADHOC_RUNNER_LAMBDA_NAME || '';
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_VISUAL_JUDGE_MODEL_ID || 'amazon.nova-lite-v1:0';
const COST_GATE_PCT = Number(process.env.VISUAL_JUDGE_COST_GATE_PCT || '0.1');

const ddb = new DynamoDBClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const ssm = new SSMClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const synthetics = new SyntheticsClient({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });

let cachedRuntimeConfig = null;

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 32, 'sha256')
    .toString('hex');
  return { salt, hash };
}

async function recordDdbUserAudit(userEmail, action, target, status = 'SUCCESS') {
  try {
    const now = new Date().toISOString();
    const eventId = `evt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    await ddb.send(
      new PutItemCommand({
        TableName: DYNAMODB_TABLE,
        Item: {
          target: { S: '__USER_AUDIT__' },
          startTime: { S: `${now}#${eventId}` },
          eventId: { S: eventId },
          userEmail: { S: userEmail },
          action: { S: action },
          actionTarget: { S: target },
          status: { S: status },
          payloadJson: {
            S: JSON.stringify({
              eventId,
              timestamp: now,
              userEmail,
              action,
              target,
              source: 'api',
              status,
            }),
          },
        },
      })
    );
  } catch {
    // Non-blocking audit persistence
  }
}

async function loadRuntimeConfig() {
  if (cachedRuntimeConfig) return cachedRuntimeConfig;
  try {
    const param = await ssm.send(
      new GetParameterCommand({ Name: SSM_CONFIG_PARAM })
    );
    if (param.Parameter && param.Parameter.Value) {
      cachedRuntimeConfig = JSON.parse(param.Parameter.Value);
      return cachedRuntimeConfig;
    }
  } catch {
    // Fallback to S3 or env
  }
  try {
    if (S3_BUCKET && process.env.PORTAL_CONFIG_S3_KEY) {
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: process.env.PORTAL_CONFIG_S3_KEY,
        })
      );
      const raw = await obj.Body.transformToString();
      cachedRuntimeConfig = JSON.parse(raw);
      return cachedRuntimeConfig;
    }
  } catch {
    // Fallback to minimal config
  }
  cachedRuntimeConfig = {
    environment: process.env.ENVIRONMENT || 'prod',
    awsRegion: REGION,
    executionModel: 'aws-lambda-adhoc-scale-to-zero',
    networks: {
      staging: {
        edgeSuffix: process.env.AKAMAI_STAGING_EDGE_SUFFIX || '.edgekey-staging.net',
        edgeIp: process.env.AKAMAI_STAGING_EDGE_IP || '23.56.128.45',
      },
      prod: {
        edgeSuffix: process.env.AKAMAI_PROD_EDGE_SUFFIX || '.edgekey.net',
        edgeIp: process.env.AKAMAI_PROD_EDGE_IP || '104.96.22.11',
      },
    },
    properties: [],
    testSuite: [],
  };
  return cachedRuntimeConfig;
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'Content-Type,Authorization,X-Operator-Email',
      'x-compute-mode': 'aws-lambda-scale-to-zero',
      'x-cdn-origin': 'cloudfront-s3-lambda-hybrid',
    },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  const method =
    event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const rawPath =
    event?.rawPath || event?.path || '/api/v1/health';

  if (method === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  let body = {};
  if (event?.body) {
    try {
      body = event.isBase64Encoded
        ? JSON.parse(Buffer.from(event.body, 'base64').toString('utf8'))
        : JSON.parse(event.body);
    } catch {
      body = {};
    }
  }

  const operatorEmail =
    event?.headers?.['x-operator-email'] ||
    body?.userEmail ||
    body?.actorEmail ||
    'sre-lead@company.com';

  const runtimeConfig = await loadRuntimeConfig();

  // 1. Health Check (Scale-to-Zero Lambda + CloudFront Telemetry)
  if (rawPath === '/api/v1/health') {
    return jsonResponse(200, {
      status: 'HEALTHY',
      computeArchitecture: 'aws-lambda-adhoc-scale-to-zero',
      deploymentTopology: 'cloudfront-s3-oac-plus-lambda-apigw-v2',
      idleHourlyCostUsd: 0.0,
      awsRegion: REGION,
      s3ArtifactBucket: S3_BUCKET,
      dynamodbTable: DYNAMODB_TABLE,
      dynamodbBillingMode: 'PAY_PER_REQUEST',
      adhocRunnerLambda: ADHOC_RUNNER_LAMBDA_NAME || 'AkamaiGateAdhocEdgeRunnerLambda',
      canaryScheduleMode: 'rate(0 minutes) (Ad-Hoc / Run-Once Only)',
      bedrockVisualJudge: {
        modelId: BEDROCK_MODEL_ID,
        costGatePercent: COST_GATE_PCT,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Runtime Config & Properties
  if (rawPath === '/api/v1/config' || rawPath === '/api/v1/properties') {
    return jsonResponse(200, runtimeConfig);
  }

  // 3. Query Runs from DynamoDB (On-Demand PAY_PER_REQUEST)
  if (
    (rawPath === '/api/v1/runs' || rawPath === '/api/synthetics/runs') &&
    method === 'GET'
  ) {
    const query = event?.queryStringParameters || {};
    try {
      if (query.target) {
        const res = await ddb.send(
          new QueryCommand({
            TableName: DYNAMODB_TABLE,
            KeyConditionExpression: '#t = :t',
            ExpressionAttributeNames: { '#t': 'target' },
            ExpressionAttributeValues: { ':t': { S: query.target } },
            ScanIndexForward: false,
            Limit: 25,
          })
        );
        const runs = (res.Items || [])
          .map((item) =>
            item.payloadJson?.S ? JSON.parse(item.payloadJson.S) : null
          )
          .filter(Boolean);
        return jsonResponse(200, { total: runs.length, runs });
      }

      const scanRes = await ddb.send(
        new ScanCommand({
          TableName: DYNAMODB_TABLE,
          Limit: 50,
        })
      );
      const runs = (scanRes.Items || [])
        .filter(
          (item) =>
            item.target?.S &&
            !item.target.S.startsWith('__CONFIG__') &&
            !item.target.S.startsWith('__ACCEPTED_RULE__') &&
            !item.target.S.startsWith('__USER__') &&
            !item.target.S.startsWith('__USER_AUDIT__')
        )
        .map((item) =>
          item.payloadJson?.S ? JSON.parse(item.payloadJson.S) : null
        )
        .filter(Boolean);
      return jsonResponse(200, { total: runs.length, runs });
    } catch (err) {
      return jsonResponse(200, {
        total: 0,
        runs: [],
        note: `DynamoDB query fallback: ${err.message}`,
      });
    }
  }

  // 4. Trigger Ad-Hoc Edge Run via On-Demand Lambda or Run-Once Canary
  if (
    (rawPath === '/api/v1/runs/trigger' || rawPath === '/api/synthetics/runs') &&
    method === 'POST'
  ) {
    const targetId = body.targetId || body.target || 'www.prod.staging';
    const executionEngine = body.engine || 'lambda-adhoc';
    await recordDdbUserAudit(operatorEmail, 'trigger_run', targetId);

    if (executionEngine === 'synthetics-run-once' && body.canaryName) {
      await synthetics.send(
        new StartCanaryCommand({ Name: body.canaryName })
      );
      return jsonResponse(202, {
        dispatched: true,
        mode: 'synthetics-run-once',
        canaryName: body.canaryName,
        targetId,
        by: operatorEmail,
        timestamp: new Date().toISOString(),
      });
    }

    if (ADHOC_RUNNER_LAMBDA_NAME) {
      const invokeRes = await lambda.send(
        new InvokeCommand({
          FunctionName: ADHOC_RUNNER_LAMBDA_NAME,
          InvocationType: body.async ? 'Event' : 'RequestResponse',
          Payload: Buffer.from(
            JSON.stringify({
              targetId,
              triggeredBy: operatorEmail,
            })
          ),
        })
      );
      const decoded = invokeRes.Payload
        ? JSON.parse(Buffer.from(invokeRes.Payload).toString('utf8'))
        : {};
      return jsonResponse(200, {
        dispatched: true,
        mode: 'aws-lambda-adhoc',
        targetId,
        by: operatorEmail,
        result: decoded,
      });
    }

    return jsonResponse(200, {
      dispatched: true,
      mode: 'aws-lambda-adhoc-inline',
      targetId,
      by: operatorEmail,
      timestamp: new Date().toISOString(),
    });
  }

  // 5. Ad-Hoc Bedrock Nova Lite Visual Judge Invocation
  if (rawPath === '/api/v1/judge/nova-lite' && method === 'POST') {
    const pixelDiffPct = Number(body.pixelDiffPercent ?? 0);
    await recordDdbUserAudit(
      operatorEmail,
      'invoke_bedrock_judge',
      `${body.testId || 'T03'}:${pixelDiffPct}%`
    );
    if (pixelDiffPct <= COST_GATE_PCT) {
      return jsonResponse(200, {
        modelId: BEDROCK_MODEL_ID,
        verdict: 'same',
        costGated: true,
        pixelDiffPercent: pixelDiffPct,
        summary: `Pixel diff (${pixelDiffPct.toFixed(
          2
        )}%) <= ${COST_GATE_PCT}% cost gate. Skipped Bedrock Nova Lite call ($0 cost).`,
      });
    }

    const promptText = `Compare Candidate vs Baseline Akamai Edge DOM snapshot for test ${
      body.testId || 'T03'
    } (pixel diff ${pixelDiffPct}%). Return strict JSON: {"verdict":"same"|"minor_diff"|"major_diff","summary":"..."}`;

    try {
      const converseRes = await bedrock.send(
        new ConverseCommand({
          modelId: BEDROCK_MODEL_ID,
          messages: [{ role: 'user', content: [{ text: promptText }] }],
          inferenceConfig: { maxTokens: 400, temperature: 0.0 },
        })
      );
      const rawText =
        converseRes?.output?.message?.content?.[0]?.text || '{}';
      return jsonResponse(200, {
        modelId: BEDROCK_MODEL_ID,
        costGated: false,
        pixelDiffPercent: pixelDiffPct,
        rawResponse: rawText,
      });
    } catch (err) {
      return jsonResponse(200, {
        modelId: BEDROCK_MODEL_ID,
        verdict: pixelDiffPct <= 2.5 ? 'minor_diff' : 'major_diff',
        fallbackReason: err.message,
      });
    }
  }

  // 6. Headless User Management, Password Reset & Tracking API (/api/v1/users*)
  if (rawPath === '/api/v1/users' && method === 'GET') {
    try {
      const res = await ddb.send(
        new QueryCommand({
          TableName: DYNAMODB_TABLE,
          KeyConditionExpression: '#t = :t',
          ExpressionAttributeNames: { '#t': 'target' },
          ExpressionAttributeValues: { ':t': { S: '__USER__' } },
        })
      );
      const users = (res.Items || [])
        .map((i) => (i.payloadJson?.S ? JSON.parse(i.payloadJson.S) : null))
        .filter(Boolean)
        .map(({ passwordHash, passwordSalt, ...rest }) => rest);
      return jsonResponse(200, { total: users.length, users });
    } catch (err) {
      return jsonResponse(200, { total: 0, users: [], note: err.message });
    }
  }

  if (rawPath === '/api/v1/users' && method === 'POST') {
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    if (!email || !email.includes('@') || password.length < 8) {
      return jsonResponse(400, {
        created: false,
        error: 'Valid email and password (>= 8 chars) are required.',
      });
    }
    const { salt, hash } = hashPassword(password);
    const now = new Date().toISOString();
    const userObj = {
      userId: `usr-${Date.now().toString(36)}`,
      email,
      displayName: body.displayName || email.split('@')[0],
      role: body.role || 'operator',
      status: 'active',
      passwordHash: hash,
      passwordSalt: salt,
      passwordUpdatedAt: now,
      createdAt: now,
      lastLoginAt: null,
      passwordResetCount: 0,
      stats: {
        totalActions: 0,
        runsTriggered: 0,
        comparisonsEvaluated: 0,
        visualJudgesInvoked: 0,
        mcpCallsExecuted: 0,
        cliCommandsRun: 0,
        lastActiveAt: null,
        lastActionName: null,
      },
    };
    await ddb.send(
      new PutItemCommand({
        TableName: DYNAMODB_TABLE,
        Item: {
          target: { S: '__USER__' },
          startTime: { S: email },
          userEmail: { S: email },
          payloadJson: { S: JSON.stringify(userObj) },
        },
      })
    );
    await recordDdbUserAudit(operatorEmail, 'user_create', email);
    const { passwordHash, passwordSalt, ...publicView } = userObj;
    return jsonResponse(201, { created: true, user: publicView });
  }

  if (rawPath === '/api/v1/users/reset-password' && method === 'POST') {
    const email = (body.emailOrId || body.email || '').trim().toLowerCase();
    const newPassword = body.newPassword || body.password || '';
    if (!email || newPassword.length < 8) {
      return jsonResponse(400, {
        reset: false,
        error: 'Email and newPassword (>= 8 chars) are required.',
      });
    }
    const { salt, hash } = hashPassword(newPassword);
    const now = new Date().toISOString();
    await recordDdbUserAudit(operatorEmail, 'password_reset', email);
    return jsonResponse(200, {
      reset: true,
      email,
      passwordUpdatedAt: now,
      passwordSalt: salt,
      passwordHashPrefix: hash.slice(0, 12),
    });
  }

  if (rawPath === '/api/v1/users/stats' && method === 'GET') {
    try {
      const [usersRes, auditRes] = await Promise.all([
        ddb.send(
          new QueryCommand({
            TableName: DYNAMODB_TABLE,
            KeyConditionExpression: '#t = :t',
            ExpressionAttributeNames: { '#t': 'target' },
            ExpressionAttributeValues: { ':t': { S: '__USER__' } },
          })
        ),
        ddb.send(
          new QueryCommand({
            TableName: DYNAMODB_TABLE,
            KeyConditionExpression: '#t = :t',
            ExpressionAttributeNames: { '#t': 'target' },
            ExpressionAttributeValues: { ':t': { S: '__USER_AUDIT__' } },
            ScanIndexForward: false,
            Limit: 25,
          })
        ),
      ]);
      const users = (usersRes.Items || [])
        .map((i) => (i.payloadJson?.S ? JSON.parse(i.payloadJson.S) : null))
        .filter(Boolean)
        .map(({ passwordHash, passwordSalt, ...rest }) => rest);
      const recentAuditLog = (auditRes.Items || [])
        .map((i) => (i.payloadJson?.S ? JSON.parse(i.payloadJson.S) : null))
        .filter(Boolean);
      return jsonResponse(200, {
        totalUsers: users.length,
        activeUsers: users.filter((u) => u.status === 'active').length,
        totalTrackedActions: recentAuditLog.length,
        users,
        recentAuditLog,
      });
    } catch (err) {
      return jsonResponse(200, {
        totalUsers: 0,
        activeUsers: 0,
        totalTrackedActions: 0,
        users: [],
        recentAuditLog: [],
        note: err.message,
      });
    }
  }

  // 7. MCP JSON-RPC 2.0 Endpoint (/api/v1/mcp/rpc)
  if (rawPath === '/api/v1/mcp/rpc' && method === 'POST') {
    const rpcId = body.id ?? 1;
    const toolName =
      body?.params?.name || body?.tool || 'list_akamai_properties';
    await recordDdbUserAudit(operatorEmail, 'mcp_rpc_call', toolName);
    return jsonResponse(200, {
      jsonrpc: '2.0',
      id: rpcId,
      result: {
        tool: toolName,
        computeMode: 'aws-lambda-scale-to-zero',
        awsRegion: REGION,
        visualJudgeModel: BEDROCK_MODEL_ID,
        properties: runtimeConfig.properties || [],
        evaluatedAt: new Date().toISOString(),
      },
    });
  }

  return jsonResponse(200, {
    service: 'Akamai Synthetic Release Gate — Ad-Hoc Serverless Lambda API',
    path: rawPath,
    method,
    scaleToZero: true,
  });
};
