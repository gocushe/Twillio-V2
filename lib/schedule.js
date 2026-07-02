export const BUSINESS_TIME_ZONE = 'America/Winnipeg';
export const DAILY_RUN_TIME = '09:00';
export const DAILY_RUN_WINDOW_MINUTES = 120;
export const DAILY_RUN_WINDOW_LABEL = '09:00 - 10:59';
export const QUIET_HOURS_START = '20:00';
export const QUIET_HOURS_END = '07:00';

function parseTime(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

export function getBusinessDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const minute = parts.minute;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${minute}`,
    minutes: Number(hour) * 60 + Number(minute),
    timeZone: BUSINESS_TIME_ZONE,
  };
}

export function getBusinessDate(date = new Date()) {
  return getBusinessDateParts(date).date;
}

export function isWithinQuietHours(date = new Date()) {
  const { minutes } = getBusinessDateParts(date);
  const start = parseTime(QUIET_HOURS_START);
  const end = parseTime(QUIET_HOURS_END);
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export function getQuietHoursStatus(date = new Date()) {
  const parts = getBusinessDateParts(date);
  return {
    quiet: isWithinQuietHours(date),
    ...parts,
    quietStart: QUIET_HOURS_START,
    quietEnd: QUIET_HOURS_END,
  };
}

export function isDailyRunWindow(date = new Date()) {
  const { minutes } = getBusinessDateParts(date);
  const target = parseTime(DAILY_RUN_TIME);
  const elapsed = minutes - target;
  return elapsed >= 0 && elapsed < DAILY_RUN_WINDOW_MINUTES;
}

export function getDailyRunStatus(date = new Date()) {
  const parts = getBusinessDateParts(date);
  const quiet = isWithinQuietHours(date);
  const inWindow = isDailyRunWindow(date);
  return {
    ...parts,
    quiet,
    shouldRun: !quiet && inWindow,
    dailyRunTime: DAILY_RUN_TIME,
    dailyRunWindow: DAILY_RUN_WINDOW_LABEL,
    quietStart: QUIET_HOURS_START,
    quietEnd: QUIET_HOURS_END,
  };
}
