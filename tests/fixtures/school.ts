/**
 * MOCKED model output for "School academy CRM". This is a hand-written blueprint standing in for what the model would
 * return; it is NOT produced by a live model. The tests push it through the real validator, compiler and stores.
 */
export const opt = (id: string, label: string) => ({ id, label })

const money = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, type: 'currency', currency: 'GBP', precision: 2, ...extra })
const rel = (id: string, label: string, source: string, target: string, extra: Record<string, unknown> = {}) => ({ id, label, sourceModuleId: source, targetModuleId: target, cardinality: 'many-to-one', deletePolicy: 'restrict', ...extra })

const charge = (amount: number, due = '2026-01-10') => ({ moduleId: 'fee_charges', values: [{ fieldId: 'amount', value: amount }, { fieldId: 'due_date', value: due }], linksToSelfVia: ['student'] })
const fine = (amount: number) => ({ moduleId: 'fines', values: [{ fieldId: 'amount', value: amount }], linksToSelfVia: ['student'] })
const pay = (amount: number, kind = 'payment') => ({ moduleId: 'payments', values: [{ fieldId: 'amount', value: amount }, { fieldId: 'kind', value: kind }], linksToSelfVia: ['student'] })

const TODAY = '2026-02-01'
const t = (name: string, related: unknown[], expected: string | null) => ({ name, record: [], related, today: TODAY, expected })

export function schoolBlueprint(projectId: string, revisionId: string): Record<string, unknown> {
  const fee1200 = charge(1200.1)
  const fines20 = fine(20.05)
  const formulaBase = { precision: 2, rounding: 'half_up', nullBehavior: 'zero', divByZero: 'null' }
  return {
    meta: {
      name: 'School academy CRM',
      description: 'Students, guardians, classes, attendance and fees',
      domain: 'education',
      locale: 'en-GB',
      currency: 'GBP',
      timezone: 'Europe/London',
      blueprintVersion: '1.0.0',
      schemaVersion: 1,
      projectId,
      revisionId,
    },
    roles: [
      { id: 'bursar', name: 'Bursar', description: 'Fees, fines and payments', grants: ['viewModules', 'createRecords', 'editRecords', 'exportData'] },
      { id: 'teacher', name: 'Teacher', description: 'Classes and attendance', grants: ['viewModules', 'createRecords', 'editRecords'] },
    ],
    modules: [
      {
        id: 'guardians',
        singular: 'Guardian',
        plural: 'Guardians',
        kind: 'entity',
        icon: 'Users',
        titleTemplate: '{full_name}',
        fields: [
          { id: 'full_name', label: 'Full name', type: 'shortText', required: true },
          { id: 'phone', label: 'Phone', type: 'phone' },
          { id: 'email', label: 'Email', type: 'email' },
        ],
      },
      {
        id: 'classes',
        singular: 'Class',
        plural: 'Classes',
        kind: 'entity',
        icon: 'School',
        titleTemplate: '{name}',
        fields: [
          { id: 'name', label: 'Name', type: 'shortText', required: true },
          { id: 'year_group', label: 'Year group', type: 'dropdown', options: [opt('y7', 'Year 7'), opt('y8', 'Year 8'), opt('y9', 'Year 9'), opt('y10', 'Year 10'), opt('y11', 'Year 11')] },
          { id: 'academic_year', label: 'Academic year', type: 'shortText' },
        ],
      },
      {
        id: 'students',
        singular: 'Student',
        plural: 'Students',
        kind: 'entity',
        icon: 'GraduationCap',
        titleTemplate: '{first_name} {last_name}',
        searchFieldIds: ['first_name', 'last_name', 'admission_no'],
        fields: [
          { id: 'first_name', label: 'First name', type: 'shortText', required: true },
          { id: 'last_name', label: 'Last name', type: 'shortText', required: true },
          { id: 'admission_no', label: 'Admission number', type: 'shortText', unique: true, required: true },
          { id: 'date_of_birth', label: 'Date of birth', type: 'date' },
        ],
      },
      {
        id: 'attendance',
        singular: 'Attendance mark',
        plural: 'Attendance',
        kind: 'log',
        icon: 'CalendarCheck',
        uniqueTogether: [['student', 'attended_on']],
        fields: [
          { id: 'attended_on', label: 'Date', type: 'date', required: true },
          { id: 'status', label: 'Status', type: 'dropdown', required: true, defaultValue: { kind: 'value', value: 'present' }, options: [opt('present', 'Present'), opt('absent', 'Absent'), opt('late', 'Late'), opt('excused', 'Excused')] },
        ],
      },
      {
        id: 'fee_charges',
        singular: 'Fee charge',
        plural: 'Fee charges',
        kind: 'transaction',
        icon: 'Receipt',
        titleTemplate: '{description}',
        fields: [
          { id: 'description', label: 'Description', type: 'shortText', required: true },
          money('amount', 'Amount', { required: true, min: 0 }),
          { id: 'due_date', label: 'Due date', type: 'date', required: true },
          { id: 'settled', label: 'Settled', type: 'yesNo', defaultValue: { kind: 'value', value: false } },
          { id: 'reference', label: 'Reference', type: 'shortText', unique: true },
        ],
      },
      {
        id: 'fines',
        singular: 'Fine',
        plural: 'Fines',
        kind: 'transaction',
        icon: 'AlertTriangle',
        titleTemplate: '{reason}',
        fields: [{ id: 'reason', label: 'Reason', type: 'shortText', required: true }, money('amount', 'Amount', { required: true, min: 0 }), { id: 'issued_on', label: 'Issued on', type: 'date' }, { id: 'reference', label: 'Reference', type: 'shortText', unique: true }],
      },
      {
        id: 'payments',
        singular: 'Payment',
        plural: 'Payments',
        kind: 'ledger',
        icon: 'Banknote',
        fields: [
          money('amount', 'Amount', { required: true, min: 0.01 }),
          { id: 'paid_on', label: 'Paid on', type: 'date', required: true },
          { id: 'kind', label: 'Type', type: 'dropdown', required: true, defaultValue: { kind: 'value', value: 'payment' }, options: [opt('payment', 'Payment'), opt('refund', 'Refund')] },
          { id: 'reference', label: 'Receipt number', type: 'shortText', required: true, unique: true },
        ],
      },
    ],
    relationships: [
      rel('guardian', 'Guardian', 'students', 'guardians', { reverseLabel: 'Students' }),
      rel('class_group', 'Class', 'students', 'classes', { reverseLabel: 'Students' }),
      rel('student', 'Student', 'attendance', 'students', { required: true, reverseLabel: 'Attendance' }),
      rel('class', 'Class', 'attendance', 'classes'),
      rel('student', 'Student', 'fee_charges', 'students', { required: true, reverseLabel: 'Fee charges' }),
      rel('student', 'Student', 'fines', 'students', { required: true, reverseLabel: 'Fines' }),
      rel('student', 'Student', 'payments', 'students', { required: true, reverseLabel: 'Payments' }),
    ],
    pipelines: [
      {
        id: 'admission_stage',
        moduleId: 'students',
        stageFieldLabel: 'Admission stage',
        stages: [
          { id: 'enquiry', label: 'Enquiry' },
          { id: 'applied', label: 'Applied' },
          { id: 'offered', label: 'Offered', requiredFieldIds: ['date_of_birth'] },
          { id: 'enrolled', label: 'Enrolled', requiredFieldIds: ['date_of_birth', 'admission_no'] },
        ],
        transitions: [
          { from: 'enquiry', to: 'applied' },
          { from: 'applied', to: 'offered' },
          { from: 'offered', to: 'enrolled' },
          { from: 'applied', to: 'enquiry' },
        ],
        trackTimeInStage: true,
      },
    ],
    formulas: [
      {
        id: 'total_fees', moduleId: 'students', label: 'Total fees', expression: 'SUM_REL(fee_charges, student, amount)', resultType: 'money', currency: 'GBP', ...formulaBase,
        sources: [{ moduleId: 'fee_charges', fieldId: 'amount' }, { moduleId: 'fee_charges', fieldId: 'student' }],
        tests: [t('no charges is zero, not empty', [], '0.00'), t('one charge', [fee1200], '1200.10'), t('two charges add exactly', [charge(0.1), charge(0.2)], '0.30')],
      },
      {
        id: 'total_fines', moduleId: 'students', label: 'Total fines', expression: 'SUM_REL(fines, student, amount)', resultType: 'money', currency: 'GBP', ...formulaBase,
        sources: [{ moduleId: 'fines', fieldId: 'amount' }, { moduleId: 'fines', fieldId: 'student' }],
        tests: [t('no fines', [], '0.00'), t('one fine', [fines20], '20.05'), t('two fines', [fine(5), fine(7.5)], '12.50')],
      },
      {
        id: 'total_paid', moduleId: 'students', label: 'Total paid', expression: 'SUM_REL(payments, student, amount, {kind} == "payment")', resultType: 'money', currency: 'GBP', ...formulaBase,
        sources: [{ moduleId: 'payments', fieldId: 'amount' }, { moduleId: 'payments', fieldId: 'student' }, { moduleId: 'payments', fieldId: 'kind' }],
        tests: [t('no payments', [], '0.00'), t('refunds are not payments', [pay(100), pay(40, 'refund')], '100.00'), t('instalments', [pay(500.1), pay(200.05)], '700.15')],
      },
      {
        id: 'total_refunded', moduleId: 'students', label: 'Total refunded', expression: 'SUM_REL(payments, student, amount, {kind} == "refund")', resultType: 'money', currency: 'GBP', ...formulaBase,
        sources: [{ moduleId: 'payments', fieldId: 'amount' }, { moduleId: 'payments', fieldId: 'student' }, { moduleId: 'payments', fieldId: 'kind' }],
        tests: [t('no refunds', [pay(100)], '0.00'), t('a refund', [pay(100), pay(40, 'refund')], '40.00'), t('none at all', [], '0.00')],
      },
      {
        id: 'outstanding', moduleId: 'students', label: 'Outstanding', expression: '{total_fees} + {total_fines} - {total_paid} + {total_refunded}', resultType: 'money', currency: 'GBP', ...formulaBase,
        description: 'Fees + fines - payments (refunds put money back on the balance)',
        sources: [{ moduleId: 'students', fieldId: 'total_fees' }, { moduleId: 'students', fieldId: 'total_fines' }, { moduleId: 'students', fieldId: 'total_paid' }, { moduleId: 'students', fieldId: 'total_refunded' }],
        tests: [
          t('unpaid', [fee1200, fines20], '1220.15'),
          t('paid in full', [fee1200, fines20, pay(1220.15)], '0.00'),
          t('partially paid in two instalments', [fee1200, fines20, pay(500.1), pay(200.05)], '520.00'),
          t('paid then fully refunded', [fee1200, fines20, pay(1220.15), pay(1220.15, 'refund')], '1220.15'),
          t('overpaid becomes a credit', [fee1200, fines20, pay(1300)], '-79.85'),
          t('overdue is the same balance', [charge(1200.1, '2025-12-01'), fines20, pay(100)], '1120.15'),
          t('float trap 0.1 + 0.2', [charge(0.3), pay(0.1), pay(0.2)], '0.00'),
        ],
      },
      {
        id: 'overdue_count', moduleId: 'students', label: 'Overdue charges', expression: 'COUNT_REL(fee_charges, student, {due_date} < TODAY())', resultType: 'integer', precision: 0, rounding: 'half_up', nullBehavior: 'zero', divByZero: 'null',
        sources: [{ moduleId: 'fee_charges', fieldId: 'student' }, { moduleId: 'fee_charges', fieldId: 'due_date' }],
        tests: [t('none', [], '0'), t('one past due, one future', [charge(10, '2026-01-01'), charge(10, '2026-06-01')], '1')],
      },
      {
        id: 'fee_status', moduleId: 'students', label: 'Fee status',
        expression: 'IF({total_fees} + {total_fines} == 0, "No charges", IF({total_refunded} > 0 && {total_refunded} == {total_paid}, "Refunded", IF({outstanding} < 0, "Overpaid", IF({outstanding} == 0, "Paid", IF({overdue_count} > 0, "Overdue", IF({total_paid} > {total_refunded}, "Partially paid", "Unpaid"))))))',
        resultType: 'text', precision: 0, rounding: 'half_up', nullBehavior: 'zero', divByZero: 'null',
        description: 'Payment status derived from the calculated balance; distinct from the admission stage',
        sources: [{ moduleId: 'students', fieldId: 'total_fees' }, { moduleId: 'students', fieldId: 'total_fines' }, { moduleId: 'students', fieldId: 'total_paid' }, { moduleId: 'students', fieldId: 'total_refunded' }, { moduleId: 'students', fieldId: 'outstanding' }, { moduleId: 'students', fieldId: 'overdue_count' }],
        tests: [
          t('no charges', [], 'No charges'),
          t('paid', [charge(100, '2026-06-01'), pay(100)], 'Paid'),
          t('partially paid', [charge(100, '2026-06-01'), pay(40)], 'Partially paid'),
          t('unpaid', [charge(100, '2026-06-01')], 'Unpaid'),
          t('overdue', [charge(100, '2026-01-01'), pay(40)], 'Overdue'),
          t('refunded', [charge(100, '2026-06-01'), pay(100), pay(100, 'refund')], 'Refunded'),
          t('overpaid', [charge(100, '2026-06-01'), pay(130)], 'Overpaid'),
        ],
      },
    ],
    forms: [
      { id: 'mark_attendance', moduleId: 'attendance', name: 'Mark attendance', submitLabel: 'Save', sections: [{ id: 'main', title: 'Attendance', columns: 2, fieldIds: ['student', 'class', 'attended_on', 'status'] }] },
      { id: 'record_payment', moduleId: 'payments', name: 'Record payment', submitLabel: 'Record', sections: [{ id: 'main', title: 'Payment', columns: 2, fieldIds: ['student', 'amount', 'paid_on', 'kind', 'reference'] }] },
    ],
    layouts: [{ moduleId: 'students', groups: [{ title: 'Student', fieldIds: ['first_name', 'last_name', 'admission_no', 'date_of_birth', 'admission_stage'] }, { title: 'Family and class', fieldIds: ['guardian', 'class_group'] }, { title: 'Fees', fieldIds: ['total_fees', 'total_fines', 'total_paid', 'total_refunded', 'outstanding', 'overdue_count', 'fee_status'] }] }],
    views: [
      { id: 'students_by_class', moduleId: 'students', name: 'By class', type: 'table', filters: [], sorts: [{ fieldId: 'last_name', dir: 'asc' }], groupByFieldId: 'class_group' },
      { id: 'overdue_students', moduleId: 'students', name: 'Fees overdue', type: 'table', filters: [{ fieldId: 'fee_status', op: 'equals', value: 'Overdue' }], sorts: [{ fieldId: 'last_name', dir: 'asc' }] },
      { id: 'attendance_calendar', moduleId: 'attendance', name: 'Calendar', type: 'calendar', filters: [], sorts: [], dateFieldId: 'attended_on' },
    ],
    workflows: [
      {
        id: 'welcome_new_student', moduleId: 'students', name: 'Welcome call for newly enrolled students',
        trigger: { type: 'status_changed', fieldId: 'admission_stage', value: 'enrolled' },
        conditions: [],
        actions: [{ id: 'a1', type: 'create_task', title: 'Welcome call to the family of {{title}}', days: 1 }],
      },
      {
        id: 'fee_reminder', moduleId: 'fee_charges', name: 'Fee reminder the day after the due date',
        description: 'Creates an in-app follow-up task. Nothing is sent outside the app.',
        trigger: { type: 'date_reached', fieldId: 'due_date', offsetDays: 1 },
        conditions: [{ id: 'c1', fieldId: 'settled', op: 'equals', value: false }],
        actions: [
          { id: 'a1', type: 'create_followup', title: 'Chase overdue fee: {{description}} for {{student}}', days: 0 },
          { id: 'a2', type: 'notify', message: 'Fee overdue: {{description}} ({{amount}})' },
        ],
      },
      {
        id: 'email_guardian', moduleId: 'fee_charges', name: 'Email the guardian when a fee is overdue',
        trigger: { type: 'date_reached', fieldId: 'due_date', offsetDays: 1 },
        conditions: [],
        actions: [{ id: 'a1', type: 'send_message', channel: 'email', message: 'Your fee is overdue' }],
      },
    ],
    dashboards: [
      {
        id: 'school_overview',
        name: 'School overview',
        components: [
          { id: 'students_total', title: 'Students', type: 'stat', moduleId: 'students', agg: 'count', dateRange: 'all', filters: [], w: 1, h: 1, definition: 'Number of student records', refresh: 'live' },
          { id: 'fees_charged', title: 'Fees charged', type: 'stat', moduleId: 'fee_charges', agg: 'sum', fieldId: 'amount', dateRange: 'all', filters: [], w: 1, h: 1, definition: 'Sum of all fee charges issued (invoiced, not received)', refresh: 'live' },
          { id: 'payments_received', title: 'Payments received', type: 'stat', moduleId: 'payments', agg: 'sum', fieldId: 'amount', dateRange: 'all', filters: [{ fieldId: 'kind', op: 'equals', value: 'payment' }], w: 1, h: 1, definition: 'Sum of payments received (refunds excluded)', refresh: 'live' },
          { id: 'admissions', title: 'Admissions pipeline', type: 'pipeline', moduleId: 'students', agg: 'count', groupByFieldId: 'admission_stage', dateRange: 'all', filters: [], w: 2, h: 2, definition: 'Students per admission stage', refresh: 'live' },
          { id: 'attendance_status', title: 'Attendance by status', type: 'bar', moduleId: 'attendance', agg: 'count', groupByFieldId: 'status', dateRange: 'all', filters: [], w: 2, h: 2, definition: 'Attendance marks per status', refresh: 'live' },
        ],
      },
    ],
    permissions: [
      { roleId: 'teacher', moduleId: 'fee_charges', access: { view: false, create: false, edit: false, delete: false } },
      { roleId: 'teacher', moduleId: 'fines', access: { view: false, create: false, edit: false, delete: false } },
      { roleId: 'teacher', moduleId: 'payments', access: { view: false, create: false, edit: false, delete: false } },
      { roleId: 'teacher', moduleId: 'attendance', access: { view: true, create: true, edit: true, delete: false } },
      { roleId: 'teacher', moduleId: 'students', access: { view: true, create: false, edit: false, delete: false }, fieldAccess: [{ fieldId: 'total_fees', access: 'hidden' }, { fieldId: 'total_fines', access: 'hidden' }, { fieldId: 'total_paid', access: 'hidden' }, { fieldId: 'total_refunded', access: 'hidden' }, { fieldId: 'outstanding', access: 'hidden' }] },
      { roleId: 'bursar', moduleId: 'fee_charges', access: { view: true, create: true, edit: true, delete: false } },
      { roleId: 'bursar', moduleId: 'payments', access: { view: true, create: true, edit: false, delete: false } },
    ],
  }
}
