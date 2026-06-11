const SHEET_ID = '1EuaUVdmlwcjYXuhWvmDAMg1hM0fuAi-bNYOv910mi-Y';

function doGet(e) {
  const sheet = SpreadsheetApp.openById(SHEET_ID);
  const jobSheet = sheet.getSheetByName('Jobs');
  const rows = jobSheet.getDataRange().getValues();
  const headers = rows[0];
  const today = new Date();

  const jobs = rows.slice(1)
    .filter(r => r[headers.indexOf('สถานะ')] === 'Active')
    .filter(r => {
      const start = new Date(r[headers.indexOf('วันเริ่ม')]);
      const end = new Date(r[headers.indexOf('วันสิ้นสุด')]);
      end.setHours(23, 59, 59);
      return today >= start && today <= end;
    })
    .map(r => ({
      jobId:     r[headers.indexOf('JobID')],
      name:      r[headers.indexOf('ชื่องาน')],
      location:  r[headers.indexOf('สถานที่')],
      lat:       parseFloat(r[headers.indexOf('Lat')]),
      lng:       parseFloat(r[headers.indexOf('Lng')]),
      radius:    parseFloat(r[headers.indexOf('รัศมี')]),
      startDate: r[headers.indexOf('วันเริ่ม')],
      endDate:   r[headers.indexOf('วันสิ้นสุด')],
    }));

  return ContentService
    .createTextOutput(JSON.stringify({ jobs }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  if (data.type === 'checkin') {
    // บังคับ team
    if (!data.team || data.team.trim() === '') {
      return jsonResponse({ status: 'error', message: 'กรุณาระบุทีม/ฝ่ายค่ะ' });
    }

    // ตรวจ duplicate — lineUserId + jobId + วันเดียวกัน
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const checkInSheet = sheet.getSheetByName('CheckIn');
    const rows = checkInSheet.getDataRange().getValues();
    const todayStr = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');

    const isDuplicate = rows.slice(1).some(r => {
      const rowDate = Utilities.formatDate(new Date(r[0]), 'Asia/Bangkok', 'yyyy-MM-dd');
      return r[3] === data.lineUserId && r[1] === data.jobId && rowDate === todayStr;
    });

    if (isDuplicate) {
      return jsonResponse({ status: 'duplicate', message: 'ลงเวลางานนี้ไปแล้ววันนี้ค่ะ' });
    }

    // บันทึก
    checkInSheet.appendRow([
      new Date(),          // A: Timestamp
      data.jobId,          // B: JobID
      data.jobName,        // C: ชื่องาน
      data.lineUserId,     // D: LineUserID
      data.lineDisplayName,// E: ชื่อใน LINE
      data.nickname,       // F: ชื่อเล่น
      data.team,           // G: ทีม
      data.latitude,       // H: Lat
      data.longitude,      // I: Lng
      data.distance        // J: ระยะห่าง
    ]);

    return jsonResponse({ status: 'success' });
  }

  return jsonResponse({ status: 'error', message: 'unknown type' });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
