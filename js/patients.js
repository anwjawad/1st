// js/patients.js
// Patients module: manage list, active patient, create/duplicate, CSV mapping

import { Utils } from './utils.js';

let Bus, State;
let activePatientCode = null;

// لتوليد كود مريض جديد (UUID مختصر)
function generateCode() {
  return 'P' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export const Patients = {
  init(bus, state) {
    Bus = bus;
    State = state;
  },

  /** أنشئ مريض فارغ داخل قسم معين */
  createEmpty(sectionName) {
    const code = generateCode();
    const patient = {
      'Patient Code': code,
      'Patient Name': '',
      'Patient Age': '',
      'Room': '',
      'Admitting Provider': '',
      'Diagnosis': '',
      'Diet': '',
      'Isolation': '',
      'Comments': '',
      'Section': sectionName,
      'Done': false,
      'Updated At': new Date().toISOString(),
      'HPI Diagnosis': '',
      'HPI Previous': '',
      'HPI Current': '',
      'HPI Initial': '',
      'Patient Assessment': '',
      'Medication List': '',
      'Latest Notes': ''
    };
    return patient;
  },

  /** انسخ مريض مع كود جديد */
  duplicate(p) {
    const copy = { ...p };
    copy['Patient Code'] = generateCode();
    copy['Patient Name'] = (p['Patient Name'] || '') + ' (Copy)';
    copy['Done'] = false;
    copy['Updated At'] = new Date().toISOString();
    return copy;
  },

  /** استرجاع المريض الحالي */
  getActive() {
    if (!activePatientCode) return null;
    return this.findByCode(activePatientCode);
  },

  setActiveByCode(code) {
    activePatientCode = code;
  },

  findByCode(code) {
    return State.patients.find(p => p['Patient Code'] === code);
  },

  /** لمس المريض (تحديث updatedAt) */
  touch(code, isoTime) {
    const p = this.findByCode(code);
    if (p) p['Updated At'] = isoTime;
  },

  /** تحويل صف CSV (من المستشفى) إلى كائن مريض مع الأعمدة الصحيحة */
  mapCsvRowToPatient(row, sectionName) {
    // الترتيب المتوقع: Patient Code, Patient Name, Patient Age, Room, Admitting Provider, Cause Of Admission, Diet, Isolation, Comments
    const code = row[0] || generateCode();
    return {
      'Patient Code': code,
      'Patient Name': row[1] || '',
      'Patient Age': row[2] || '',
      'Room': row[3] || '',
      'Admitting Provider': row[4] || '',
      'Diagnosis': row[5] || '', // Cause Of Admission → Diagnosis
      'Diet': row[6] || '',
      'Isolation': row[7] || '',
      'Comments': row[8] || '',
      'Section': sectionName,
      'Done': false,
      'Updated At': new Date().toISOString(),
      'HPI Diagnosis': '',
      'HPI Previous': '',
      'HPI Current': '',
      'HPI Initial': '',
      'Patient Assessment': '',
      'Medication List': '',
      'Latest Notes': ''
    };
  }
};
