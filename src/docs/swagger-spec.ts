import swaggerJsdoc from 'swagger-jsdoc';

// Shared response schemas referenced from @openapi comments across
// controllers via $ref: '#/components/schemas/<Name>' — matches each
// entity's actual TypeScript shape (src/entities/*.entity.ts) so the
// docs stay in sync with what the API actually returns.
const swaggerBaseFields = {
	id: { type: 'integer' },
	isDeleted: { type: 'boolean' },
	deletedAt: { type: 'string', format: 'date-time', nullable: true },
	createdAt: { type: 'string', format: 'date-time' },
	updatedAt: { type: 'string', format: 'date-time' },
};

export const swaggerSpec = swaggerJsdoc({
	definition: {
		openapi: '3.0.0',
		info: { title: 'Clasifacil API', version: '1.0.0' },
		components: {
			schemas: {
				Operator: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						name: { type: 'string' },
						email: { type: 'string' },
						stripeAccountId: { type: 'string', nullable: true },
						onboardingStatus: { type: 'string', nullable: true },
					},
				},
				User: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						authUid: { type: 'string' },
						email: { type: 'string' },
						role: { type: 'string' },
						associatedEntityId: { type: 'integer', nullable: true },
					},
				},
				Household: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						name: { type: 'string' },
						email: { type: 'string' },
					},
				},
				Student: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						householdId: { type: 'integer' },
						fullName: { type: 'string' },
						dateOfBirth: { type: 'string', format: 'date-time', nullable: true },
						notes: { type: 'string', nullable: true },
					},
				},
				Session: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						operatorId: { type: 'integer' },
						title: { type: 'string' },
						startTime: { type: 'string', format: 'date-time' },
						capacityLimit: { type: 'integer' },
						currentRosterCount: { type: 'integer', nullable: true },
					},
				},
				EnrollmentAndCredit: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						studentId: { type: 'integer' },
						sessionId: { type: 'integer', nullable: true },
						householdId: { type: 'integer' },
						status: { type: 'string' },
						creditTokenExpiry: { type: 'string', format: 'date-time', nullable: true },
					},
				},
				InvoiceAndPayment: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						householdId: { type: 'integer' },
						operatorId: { type: 'integer' },
						amount: { type: 'string', description: 'Decimal string, e.g. "49.99"' },
						paymentType: { type: 'string' },
						status: { type: 'string' },
						stripeChargeId: { type: 'string', nullable: true },
					},
				},
			},
			// Referenced via $ref: '#/components/responses/<Name>' from
			// route comments, instead of repeating the same block on
			// every route.
			//
			// BadRequest/Unauthorized are documented as the intended
			// contract, not current behavior: no input-validation or
			// auth middleware exists in this codebase yet (a bad body
			// currently throws -> 500; every route is unauthenticated).
			// InternalError matches RouteHandlers.errorHandler's actual
			// response shape — every route can genuinely return this.
			responses: {
				BadRequest: {
					description: 'Invalid request body or parameters',
				},
				Unauthorized: {
					description: 'Missing or invalid authentication',
				},
				InternalError: {
					description: 'Unexpected server error',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: { type: 'string' },
									correlationId: { type: 'string' },
								},
							},
						},
					},
				},
			},
		},
	},
	// Resolved relative to process.cwd() (the project root when run via
	// npm scripts), not this file's own location — must stay as-is if
	// this file ever moves.
	apis: ['./src/controllers/*.ts'],
});
