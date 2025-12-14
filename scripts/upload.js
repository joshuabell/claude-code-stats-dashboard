#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// Helper to calculate stats from days array
function calculateStats(days) {
  if (!days || days.length === 0) {
    return {
      totalCost: 0,
      totalTokens: 0,
      averageCost: 0,
      averageTokens: 0,
      dayCount: 0
    };
  }

  const totalCost = days.reduce((sum, day) => sum + (day.totalCost || 0), 0);
  const totalTokens = days.reduce((sum, day) => sum + (day.totalTokens || 0), 0);

  return {
    totalCost,
    totalTokens,
    averageCost: totalCost / days.length,
    averageTokens: totalTokens / days.length,
    dayCount: days.length
  };
}

// Helper to calculate streaks
function calculateStreaks(days) {
  if (days.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  const lastDay = new Date(days[days.length - 1].date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const lastDayTime = new Date(lastDay).setHours(0, 0, 0, 0);
  const isActiveStreak = lastDayTime === today.getTime() || lastDayTime === yesterday.getTime();

  for (let i = 1; i < days.length; i++) {
    const prevDay = new Date(days[i - 1].date);
    const currDay = new Date(days[i].date);
    prevDay.setHours(0, 0, 0, 0);
    currDay.setHours(0, 0, 0, 0);

    const diffDays = Math.round((currDay - prevDay) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }

  longestStreak = Math.max(longestStreak, tempStreak);

  if (isActiveStreak) {
    currentStreak = tempStreak;
  }

  return { currentStreak, longestStreak };
}

// Helper to calculate period stats
function calculatePeriodStats(days, startDate) {
  const periodDays = days.filter(day => {
    const dayDate = new Date(day.date);
    return dayDate >= startDate;
  });

  return calculateStats(periodDays);
}

// Process ccusage data
function processUsageData(ccusageData, existingDays = []) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // Convert existing days to map for easy lookup
  const daysMap = {};
  existingDays.forEach(day => {
    const dateKey = new Date(day.date).toISOString().split('T')[0];
    daysMap[dateKey] = day;
  });

  // Process incoming usage data
  // ccusage outputs data.daily, not data.usage.days
  const dailyData = ccusageData.daily || ccusageData.usage?.days || [];
  dailyData.forEach(dayData => {
    const dateKey = dayData.date;
    daysMap[dateKey] = {
      date: dayData.date,
      totalCost: dayData.totalCost || 0,
      totalTokens: dayData.totalTokens || 0,
      inputTokens: dayData.inputTokens || 0,
      outputTokens: dayData.outputTokens || 0,
      cacheTokens: dayData.cacheCreationTokens || dayData.cacheTokens || 0
    };
  });

  // Convert back to sorted array
  const days = Object.values(daysMap).sort((a, b) =>
    new Date(a.date) - new Date(b.date)
  );

  // Calculate all metrics
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const weeklyStats = calculatePeriodStats(days, weekStart);
  const monthlyStats = calculatePeriodStats(days, monthStart);
  const yearlyStats = calculatePeriodStats(days, yearStart);
  const lifetimeStats = calculateStats(days);
  const streaks = calculateStreaks(days);

  // Calculate highest day/week/month
  let highestDay = { totalCost: 0, totalTokens: 0, date: null };
  days.forEach(day => {
    if (day.totalCost > highestDay.totalCost) {
      highestDay = {
        totalCost: day.totalCost,
        totalTokens: day.totalTokens,
        date: day.date
      };
    }
  });

  // Calculate weekly aggregates
  const weeklyAggregates = {};
  days.forEach(day => {
    const date = new Date(day.date);
    const weekNum = getWeekNumber(date);
    const year = date.getFullYear();
    const key = `${year}-W${weekNum}`;

    if (!weeklyAggregates[key]) {
      weeklyAggregates[key] = { totalCost: 0, totalTokens: 0 };
    }
    weeklyAggregates[key].totalCost += day.totalCost || 0;
    weeklyAggregates[key].totalTokens += day.totalTokens || 0;
  });

  let highestWeek = { totalCost: 0, totalTokens: 0 };
  Object.values(weeklyAggregates).forEach(week => {
    if (week.totalCost > highestWeek.totalCost) {
      highestWeek = week;
    }
  });

  // Calculate monthly aggregates
  const monthlyAggregates = {};
  days.forEach(day => {
    const date = new Date(day.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!monthlyAggregates[key]) {
      monthlyAggregates[key] = { totalCost: 0, totalTokens: 0 };
    }
    monthlyAggregates[key].totalCost += day.totalCost || 0;
    monthlyAggregates[key].totalTokens += day.totalTokens || 0;
  });

  let highestMonth = { totalCost: 0, totalTokens: 0 };
  Object.values(monthlyAggregates).forEach(month => {
    if (month.totalCost > highestMonth.totalCost) {
      highestMonth = month;
    }
  });

  // Calculate daily velocity (avg of last 7 days)
  const recentDays = days.slice(-7);
  const dailyVelocity = recentDays.length > 0 ? {
    totalCost: recentDays.reduce((sum, day) => sum + (day.totalCost || 0), 0) / recentDays.length,
    totalTokens: recentDays.reduce((sum, day) => sum + (day.totalTokens || 0), 0) / recentDays.length
  } : { totalCost: 0, totalTokens: 0 };

  return {
    days,
    stats: {
      lifetime: lifetimeStats,
      yearly: yearlyStats,
      monthly: monthlyStats,
      weekly: weeklyStats,
      daily: dailyVelocity,
      highest: {
        day: highestDay,
        week: highestWeek,
        month: highestMonth
      },
      streaks: streaks,
      lastUpdated: now.toISOString()
    }
  };
}

// Helper to get week number
function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

// Run ccusage and get JSON output
async function runCCUsage() {
  return new Promise((resolve, reject) => {
    exec('npx ccusage --json', (error, stdout, stderr) => {
      if (error) {
        console.error('Error running ccusage:', stderr);
        reject(error);
        return;
      }
      try {
        const json = JSON.parse(stdout);
        resolve(json);
      } catch (e) {
        console.error('Failed to parse ccusage output:', stdout);
        reject(new Error('Failed to parse ccusage output'));
      }
    });
  });
}

// Main function
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║   Claude Code Usage Analytics - Data Upload          ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  try {
    // Paths
    const dataDir = path.join(__dirname, '..', 'data');
    const statsFile = path.join(dataDir, 'stats.json');
    const daysFile = path.join(dataDir, 'days.json');

    // Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });

    console.log('📊 Running ccusage to collect usage data...\n');
    const ccusageData = await runCCUsage();

    // Load existing data
    let existingDays = [];
    try {
      const daysData = await fs.readFile(daysFile, 'utf-8');
      existingDays = JSON.parse(daysData);
      console.log(`✓ Loaded ${existingDays.length} existing days of data\n`);
    } catch (err) {
      console.log('✓ No existing data found, starting fresh\n');
    }

    console.log('⚙️  Processing usage data...\n');
    const result = processUsageData(ccusageData, existingDays);

    // Save updated data
    await fs.writeFile(statsFile, JSON.stringify(result.stats, null, 2));
    await fs.writeFile(daysFile, JSON.stringify(result.days, null, 2));

    console.log('✅ Success! Data files updated:\n');
    console.log(`   📄 ${statsFile}`);
    console.log(`   📄 ${daysFile}\n`);

    console.log('📈 Your Stats:');
    console.log(`   Total Cost: $${result.stats.lifetime.totalCost?.toFixed(2) || '0.00'}`);
    console.log(`   Total Tokens: ${result.stats.lifetime.totalTokens?.toLocaleString() || '0'}`);
    console.log(`   Days Active: ${result.stats.lifetime.dayCount || 0}`);
    console.log(`   Current Streak: ${result.stats.streaks.currentStreak || 0} days`);
    console.log(`   Longest Streak: ${result.stats.streaks.longestStreak || 0} days\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Next steps:');
    console.log('  1. Review changes: git diff');
    console.log('  2. Commit and push: git add . && git commit -m "Update usage stats" && git push');
    console.log('  3. View your dashboard (GitHub Pages will auto-deploy)\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
