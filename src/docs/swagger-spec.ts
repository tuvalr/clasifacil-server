import swaggerJsdoc from 'swagger-jsdoc';

// Shared response schemas referenced from @openapi comments across
// controllers via $ref: '#/components/schemas/<Name>' — matches each
// entity's PUBLIC (PublicEntity<T>, see src/entities/base.entity.ts) shape,
// not the raw DB entity: deletedAt/createdAt/updatedAt are DB-managed
// bookkeeping that every controller strips via toPublic() before responding
// (src/utils/to-public.ts), so they're deliberately absent here too.
const swaggerBaseFields = {
	id: { type: 'integer' },
	isDeleted: { type: 'boolean' },
};

export const swaggerSpec = swaggerJsdoc({
	definition: {
		openapi: '3.0.0',
		info: { title: 'Clasifacil API', version: '1.0.0' },
		// Explicit order so Swagger UI groups tags as Admin, then Household,
		// then Operator (alphabetical within Household/Operator), instead of
		// whatever order swagger-jsdoc happens to scan the controller files in.
		tags: [
			{ name: 'Admin' },
			{ name: 'Household - Attendance Credits' },
			{ name: 'Household - Billing' },
			{ name: 'Household - Booking' },
			{ name: 'Household - Households' },
			{ name: 'Household - Settings' },
			{ name: 'Operator - Attendance Credits' },
			{ name: 'Operator - Billing' },
			{ name: 'Operator - Classes' },
			{ name: 'Operator - Households' },
			{ name: 'Operator - Sessions' },
			{ name: 'Operator - Settings' },
		],
		components: {
			schemas: {
				Operator: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						name: { type: 'string' },
						email: { type: 'string' },
						phone: { type: 'string' },
						countryCode: { type: 'string' },
						stripeAccountId: { type: 'string', nullable: true },
						onboardingStatus: { type: 'string', nullable: true },
						status: { type: 'string', enum: ['active', 'paused'] },
						pausedUntil: { type: 'string', format: 'date-time', nullable: true },
						avatarUrl: { type: 'string', nullable: true },
						type: { type: 'string', enum: ['schedule', 'assigned'] },
					},
				},
				OperatorDetails: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						name: { type: 'string' },
						email: { type: 'string' },
						phone: { type: 'string' },
						countryCode: { type: 'string' },
						stripeAccountId: { type: 'string', nullable: true },
						onboardingStatus: { type: 'string', nullable: true },
						status: { type: 'string', enum: ['active', 'paused'] },
						pausedUntil: { type: 'string', format: 'date-time', nullable: true },
						avatarUrl: { type: 'string', nullable: true },
						type: { type: 'string', enum: ['schedule', 'assigned'] },
						sessions: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									...swaggerBaseFields,
									operatorId: { type: 'integer' },
									title: { type: 'string' },
									startTime: { type: 'string', format: 'date-time' },
									capacityLimit: { type: 'integer' },
									currentRosterCount: { type: 'integer', nullable: true },
									enrollments: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												...swaggerBaseFields,
												studentId: { type: 'integer' },
												sessionId: { type: 'integer', nullable: true },
												householdId: { type: 'integer' },
												status: { type: 'string' },
												creditTokenExpiry: { type: 'string', format: 'date-time', nullable: true },
												student: { allOf: [{ $ref: '#/components/schemas/Student' }], nullable: true },
												household: { allOf: [{ $ref: '#/components/schemas/Household' }], nullable: true },
											},
										},
									},
								},
							},
						},
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
						avatarUrl: { type: 'string', nullable: true },
						status: { type: 'string', enum: ['active', 'paused'] },
						pausedUntil: { type: 'string', format: 'date-time', nullable: true },
					},
				},
				HouseholdDetails: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						name: { type: 'string' },
						email: { type: 'string' },
						avatarUrl: { type: 'string', nullable: true },
						status: { type: 'string', enum: ['active', 'paused'] },
						pausedUntil: { type: 'string', format: 'date-time', nullable: true },
						students: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									...swaggerBaseFields,
									householdId: { type: 'integer' },
									fullName: { type: 'string' },
									dateOfBirth: { type: 'string', format: 'date-time', nullable: true },
									notes: { type: 'string', nullable: true },
									enrollments: { type: 'array', items: { $ref: '#/components/schemas/EnrollmentAndCredit' } },
								},
							},
						},
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
						title: { type: 'string', nullable: true },
						startTime: { type: 'string', format: 'date-time' },
						capacityLimit: { type: 'integer' },
						currentRosterCount: { type: 'integer', nullable: true },
						classId: { type: 'integer', nullable: true },
						isMakeupSession: { type: 'boolean' },
					},
				},
				// A class occurrence is either virtual (derived on-the-fly from the class's recurring pattern, never
				// persisted) or materialized (a real row in `sessions`, once rescheduled/cancelled/attendance-recorded
				// or explicitly backfilled) — isVirtual discriminates which fields are populated: classId only on
				// virtual entries, sessionId/isMakeupSession only on materialized ones.
				Occurrence: {
					type: 'object',
					properties: {
						isVirtual: { type: 'boolean' },
						classId: { type: 'integer', nullable: true, description: 'Present only when isVirtual is true' },
						sessionId: { type: 'integer', nullable: true, description: 'Present only when isVirtual is false' },
						startTime: { type: 'string', format: 'date-time' },
						isMakeupSession: { type: 'boolean', nullable: true, description: 'Present only when isVirtual is false' },
						title: { type: 'string', nullable: true },
					},
				},
				SessionAttendanceEntry: {
					type: 'object',
					properties: {
						studentId: { type: 'integer' },
						status: { type: 'string', enum: ['present', 'absent', 'approved_absent'] },
					},
				},
				Class: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						operatorId: { type: 'integer' },
						title: { type: 'string' },
						dayOfWeek: { type: 'integer' },
						startTime: { type: 'string' },
						durationMinutes: { type: 'integer' },
						minSize: { type: 'integer', nullable: true },
						maxSize: { type: 'integer' },
						status: { type: 'string', enum: ['active', 'stopped'] },
						stoppedAt: { type: 'string', format: 'date-time', nullable: true },
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
	// this file ever moves. Recursive (**) since each controller now
	// lives in its own subfolder (src/controllers/admin/admin.controller.ts
	// etc.) rather than flat under src/controllers/.
	apis: ['./src/controllers/**/*.controller.ts'],
});
