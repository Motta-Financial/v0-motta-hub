import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// CSV data from AIRTABLE_TOMMYS_1.2.2026.csv
const csvData = `BALLOT DATE,VOTER,PARTNER VOTE,PARTNER VOTE NOTES,FIRST PLACE VOTE,FIRST PLACE VOTE NOTES,SECOND PLACE VOTE,SECOND PLACE VOTE NOTES,THIRD PLACE VOTE,THIRD PLACE VOTE NOTES,HONORABLE MENTION VOTE,HONORABLE MENTION NOTES,GENERAL NOTES
12/25/2025,Dat Le,Mark Dwyer,Getting renewal proposals out,Matthew Pereira,A-Team poop clean up,Grace Cha,Working on SHIN while on break,Andrew Gianares,Month End Close,Sophia Echevarria,Because I miss her,MERRY CHRISTMAS
12/19/2025,Mark Dwyer,Dat Le,Taking on Dalton and Sheriffs and a little bit of everything,Sophia Echevarria,Longest internship ever! Great job and good luck in your next adventure!,Matthew Pereira,Poop nukes,Andrew Gianares,Crushing month end closes and client meetings,Caroline Buckley,Keeping everything moving on the ADVS front ,Merry Christmas!
12/19/2025,Dat Le,Sophia Echevarria,"Motta's first, best, and longest tenured Intern the firm has ever seen!! Impressive how you came to us as a marketing intern and quickly grew into one of the most outstanding young leaders I've ever had the chance to work with.  Go do great things, Sophia!! ",Sophia Echevarria,But also work on your skills in Microsoft outlook. ,Sophia Echevarria,And also introducing yourself by your first and last name instead of your job title. ,Sophia Echevarria,And also trying to relax a bit so that you don't get ulcers. ,Sophia Echevarria,"But still keep being you because that Sophia is a wonderful person! Remember, you're Kevin Durant! ",GOODBYE SOPHIA!! GOOD LUCK AT DELOITTE! 
12/19/2025,Sophia Echevarria,Dat Le,forever grateful for the opportunity to start my career here at Motta. #padawan4life,Mark Dwyer,,Caroline Buckley,,Matthew Pereira,,Grace Cha,,zip it up and zip it out! best wishes to all and good luck during busy season!!!
12/19/2025,Matthew Pereira,Dat Le,,Sophia Echevarria,,Andrew Gianares,,Mark Dwyer,,Caroline Buckley,,
12/19/2025,Andrew Gianares,Dat Le,,Caroline Buckley,,Mark Dwyer,,Matthew Pereira,,Sophia Echevarria,,
12/18/2025,Caroline Buckley,Sophia Echevarria,last week with sophia :( we appreciate all of your hard work and there is no doubt in my mind you are going to absolutely crush your internship w/ Deloitte!! we will miss you so much but we are rooting for you and cheering you on from the sidelines!! congrats on a great semester and can't wait to see all that you accomplish in this next chapter!!,Sophia Echevarria,,Sophia Echevarria,,Sophia Echevarria,,Sophia Echevarria,,
12/18/2025,Grace Cha,Dat Le,"helping out in areas that are needed. being a team player, helping when i was unable to work due to travels and circumstances.",Sophia Echevarria,"MY SHAYLAAAA. will miss her SOOO MUCH. work will not be same without you........ <333333 working with you was soooo easy, never had someone who was as easy and smooth to work with!",Andrew Gianares,crushing through all the accounting and poop cleanup....,Matthew Pereira,crushing through all the accounting and poop cleanup....,Caroline Buckley,"working hard as always, get better soon!!!",
12/12/2025,Matthew Pereira,Dat Le,,Andrew Gianares,,Caroline Buckley,,Mark Dwyer,,Sophia Echevarria,,
12/12/2025,Caroline Buckley,Dat Le,,Mark Dwyer,,Grace Cha,,Sophia Echevarria,,Andrew Gianares,,
12/12/2025,Grace Cha,Dat Le,,Sophia Echevarria,crushing finals and also helping out w the team !!,Caroline Buckley,,Matthew Pereira,,Andrew Gianares,,
12/11/2025,Sophia Echevarria,Dat Le,,Grace Cha,slaying finals and working,Caroline Buckley,,Matthew Pereira,,Andrew Gianares,,
12/11/2025,Dat Le,Mark Dwyer,Great job getting organized and closing BUSINESS,Matthew Pereira,We hit budget on 12/10 and it was like 90% accounting.  Thank you for everything you do and leading the A-Team! ,Grace Cha,"Organizing SHIN by coming up with a plan, acquiring the resources (intern), and organizing/leading the team to get the project back on the rails.   ",Andrew Gianares,Keeping Month End Close moving while in New Jersey recruiting Joey Ballgame. ,Caroline Buckley,Keeping tax moving with client craziness!! ,"We're blowing up like we thought we would! Call the crib same number same hood, it's all good!!  "
12/11/2025,Mark Dwyer,Dat Le,"Offense, defense, special teams",Andrew Gianares,"Taking Motta on the road! Hong Close, Hanging with Mark at the Cs game. Client meetings, monthly closes, poopnukes on deck",Matthew Pereira,"Working with clients on onboarding, clean up projects, crushing client interactions",Caroline Buckley,"Keeping everything organized and moving along, getting Simons stuff filed super fast",Grace Cha,helping out the account squad and working on SHIN ,
12/5/2025,Andrew Gianares,Dat Le,Continue to do biz dev,Matthew Pereira,Helping with accounting and adding structure. ,Caroline Buckley,Queuing up the tax side and staying organized,Mark Dwyer,Managing all aspects and helping out in all areas,Sophia Echevarria,Special teams and helping out on the tax side,
12/4/2025,Dat Le,Dat Le,I thought I filled up the stat sheet this week!,Andrew Gianares,The commitment to go to Halifax and finally bury Giang Enterprises / Halifax Nails is what the firm is made of! Way to work and do whatever it takes to get shit done! ,Grace Cha,Surviving her first Celtics game and sticking up for the dude that got punched sticking up for you and your roommate.  Also doing great work on the tax side and starting to ramp up for a Special Teams SPRINT. ,Matthew Pereira,Leading the A-Team and fielding all of my Biz Dev on the accounting side while still managing Month Ends! ,Caroline Buckley,Feels like an Honorable Mention is light for basically completely taking over the tax department independently but hey.. pretty stacked week. ,Have fun at the holiday gathering tomorrow and I wish I was there with you guys!! 
11/28/2025,Dat Le,Mark Dwyer,For Kylee finishing clinicals!,Matthew Pereira,"Putting in an insane amount of work during OCP's ""You time"" and Matty being Matty",Grace Cha,"Putting out 10/10 work on client roll forwards, RP, and all the other work! Great effort",Andrew Gianares,You time utilization.. FINALLY!,Sophia Echevarria,"Contributing in all areas, being a model culture setter at Motta, and overall great teammate",Happy Thanksgiving team!! 
11/21/2025,Matthew Pereira,Dat Le,,Caroline Buckley,,Mark Dwyer,,Andrew Gianares,,Sophia Echevarria,,
11/20/2025,Caroline Buckley,Dat Le,,Andrew Gianares,,Mark Dwyer,,Sophia Echevarria,,Grace Cha,,
11/20/2025,Mark Dwyer,,,Caroline Buckley,Enrolled Agent whoop whoop!!!,Matthew Pereira,Helping out of the SEED Forecasting Front and being Matt,Sophia Echevarria,Grinding on tax season set up ,Andrew Gianares,"Monthly Meetings, Monthly Closes and getting great feedback leading to referrals ",
11/20/2025,Dat Le,Mark Dwyer,Getting the Synergy proposals out,Caroline Buckley,"EA Exam, First Referral, and generally just crushing it",Sophia Echevarria,Chipping in where she can and even volunteering to do ProConnect contact poop clean up.  A+ ,Matthew Pereira,Keeping the A-Team afloat along with all of the other things you do to help the squad,Andrew Gianares,Just always being a team player and getting shit done,"Big week in a lot of ways for the firm, client intake is heating up and feel really good about the momentum we're getting as a team! "
11/14/2025,Mark Dwyer,,,Caroline Buckley,"great job leading template updates, marketing materials and running all things tax",Sophia Echevarria,crushed all of the template updates,Matthew Pereira,Accounting clean up and client meetings,Andrew Gianares,Always contributing and helping out the squad,
11/14/2025,Dat Le,Mark Dwyer,"Great job being a great teammate this week! Way to jump in all areas to help the team dig out of the hole.",Sophia Echevarria,"Sophia came back this semester and I'm not sure how many hours she works every week",Caroline Buckley,"Caroline might have gotten the lion's share of the Mamba'ing this week",Andrew Gianares,"I don't think Andrew has taken a vacation day all year",Ganesh Vasan,"While the team was getting caught up on Firm Infrastructure, P24 was out here keeping the A-Team afloat","Tough week and I'm acknowledging that I'm the one who created this environment."
11/14/2025,Matthew Pereira,Dat Le,,Mark Dwyer,,Andrew Gianares,,Caroline Buckley,,Sophia Echevarria,,
11/7/2025,Matthew Pereira,Dat Le,,Mark Dwyer,,Grace Cha,,Caroline Buckley,,Andrew Gianares,,
11/6/2025,Dat Le,Dat Le,Don't think Mark deserved the Partner vote this week,Sophia Echevarria,"Tommy's are meant for being a good teammate",Andrew Gianares,Way to show tremendous growth!,Caroline Buckley,Keeping our tax department moving!,Ganesh Vasan,Shout out to P24!,"We are up ~2,200% from last year!"
11/6/2025,Caroline Buckley,Dat Le,keeping special projects moving forward,Mark Dwyer,"Keeping everything moving along",Grace Cha,Special teams queen,Matthew Pereira,Keeping accounting on track,Sophia Echevarria,Quietly creating templates,
11/6/2025,Andrew Gianares,Mark Dwyer,Congrats on being elected as Vice Chair!,Dat Le,Special teams and keeps the firm going,Matthew Pereira,Continuing to help in all areas,Caroline Buckley,Efficient and managing the tax department,Grace Cha,AI guru,
10/31/2025,Mark Dwyer,Dat Le,3pm valuation,Grace Cha,Special Teams - Motta Hub and SHIN!!!,Sophia Echevarria,Template Work - silent assassin ,Andrew Gianares,"Staying on top of bookkeeping, payroll",Caroline Buckley,Crushing client meetings and emails,
10/31/2025,Dat Le,Mark Dwyer,Keeping the ship moving!! ,Grace Cha,Special Teams machine!!,Caroline Buckley,I don't have to worry about the tax department,Ganesh Vasan,P24 basically keeping our bookkeeping clients moving,Matthew Pereira,Matty being Matty!!,
10/31/2025,Sophia Echevarria,Dat Le,,Mark Dwyer,,Caroline Buckley,,Andrew Gianares,,Matthew Pereira,,
10/31/2025,Grace Cha,Dat Le,3PM...... ,Caroline Buckley,,Matthew Pereira,,Sophia Echevarria,,Mark Dwyer,,
10/31/2025,Matthew Pereira,Dat Le,"Dealing with 3PM and their outrageous business valuation demands",Grace Cha,Killing it on the Special Teams,Caroline Buckley,"Props for making the first EA test her bitch",Andrew Gianares,Making moves on the internal side,Mark Dwyer,Doing Mark things,
10/30/2025,Caroline Buckley,Dat Le,fighting through mitch's delusions,Mark Dwyer,,Grace Cha,,Sophia Echevarria,,Matthew Pereira,,
10/30/2025,Andrew Gianares,Dat Le,Continue in making sure the firm is growing,Grace Cha,Highly impressed with her being able to create a dashboard,Mark Dwyer,SEED and working in the backgrounds,Caroline Buckley,Keeping the tax side going,Matthew Pereira,Continue to work in all areas,
10/23/2025,Caroline Buckley,Dat Le,,Mark Dwyer,,Matthew Pereira,,Andrew Gianares,,Sophia Echevarria,,
10/23/2025,Dat Le,Mark Dwyer,"Always keeping the lights on",Andrew Gianares,Keeping our Month End going,Matthew Pereira,Matty being Matty!,Caroline Buckley,Covering Client Meetings solo!,Grace Cha,Crushing Tax Prep and Special Teams!,Let's close out October team!!
10/17/2025,Matthew Pereira,Dat Le,"Continuing to steer the ship",Caroline Buckley,Absolutely crushed 10/15 deadline,Andrew Gianares,All the kudos with handling the chaos,Grace Cha,Full shout out to the Tax Gurlz,Mark Dwyer,Keeping on top of everything,
10/17/2025,Dat Le,Mark Dwyer,Keeping the squad moving,Caroline Buckley,"Absolutely CRUSHING the 10/15 deadline",Andrew Gianares,You down with OCP?!,Matthew Pereira,"Keeping the A-Team moving",Sophia Echevarria,"Thanks for having me at nerd club!",Deadline szn is over!!
10/17/2025,Sophia Echevarria,Dat Le,Crushing it as always!,Caroline Buckley,The tax gurlz fearless leader!,Grace Cha,Shoutout tax gurlz!,Mark Dwyer,Staying on top of everything!,Andrew Gianares,Dealing w a bunch of chaos!,
10/17/2025,Grace Cha,Dat Le,"coming to boston, working hard as always",Caroline Buckley,"kept us in check for the 10/15 deadline",Andrew Gianares,"working hard for the 10/15 deadline",Matthew Pereira,handling last minute clients,Sophia Echevarria,"so good with collaborating with me",
10/16/2025,Andrew Gianares,Dat Le,SEED and continuing on special teams,Caroline Buckley,Tax deadline finisher! Great job!,Matthew Pereira,Continuing to help and be a team player,Mark Dwyer,Jump in where things are needed and SEED,Sophia Echevarria,Killing it and learning especially with greg colby! Great job!,
10/10/2025,Caroline Buckley,Dat Le,"coaching, special teams, tax - balancing it all",Mark Dwyer,helping out tax get returns done,Sophia Echevarria,crushing extension returns,Grace Cha,crushing extension returns,Andrew Gianares,october accountant,
10/10/2025,Andrew Gianares,Dat Le,Continue to be special team king,Mark Dwyer,Always helping out in all areas,Matthew Pereira,Continue to be a good teammate,Grace Cha,Tax deadline crunch!,Sophia Echevarria,Tax deadline crunch!,
10/10/2025,Matthew Pereira,Dat Le,The Man,Mark Dwyer,Keeping things organized,Caroline Buckley,Tax deadline prep,Grace Cha,Tax deadline prep,Andrew Gianares,Month end machine,
10/10/2025,Dat Le,Mark Dwyer,Keeping the train moving!,Caroline Buckley,Tax deadline prep!,Grace Cha,Tax deadline prep!,Matthew Pereira,A-Team leader!,Sophia Echevarria,Tax deadline prep!,Let's go team!`

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.split("\n")
  const headers = parseCSVLine(lines[0])
  const results: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      const values = parseCSVLine(lines[i])
      const row: Record<string, string> = {}
      headers.forEach((header, index) => {
        row[header] = values[index] || ""
      })
      results.push(row)
    }
  }
  return results
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null
  const [month, day, year] = dateStr.split("/")
  if (!month || !day || !year) return null
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

async function importBallots() {
  console.log("Starting Tommy Award Ballots import...")

  const rows = parseCSV(csvData)
  console.log(`Parsed ${rows.length} ballots from CSV`)

  const ballots = rows.map((row) => ({
    week_date: parseDate(row["BALLOT DATE"]),
    voter_name: row["VOTER"] || null,
    partner_vote_name: row["PARTNER VOTE"] || null,
    partner_vote_notes: row["PARTNER VOTE NOTES"] || null,
    first_place_name: row["FIRST PLACE VOTE"] || null,
    first_place_notes: row["FIRST PLACE VOTE NOTES"] || null,
    second_place_name: row["SECOND PLACE VOTE"] || null,
    second_place_notes: row["SECOND PLACE VOTE NOTES"] || null,
    third_place_name: row["THIRD PLACE VOTE"] || null,
    third_place_notes: row["THIRD PLACE VOTE NOTES"] || null,
    honorable_mention_name: row["HONORABLE MENTION VOTE"] || null,
    honorable_mention_notes: row["HONORABLE MENTION NOTES"] || null,
    submitted_at: row["BALLOT DATE"] ? new Date(row["BALLOT DATE"]).toISOString() : new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))

  // Insert in batches of 50
  const batchSize = 50
  let inserted = 0
  let errors = 0

  for (let i = 0; i < ballots.length; i += batchSize) {
    const batch = ballots.slice(i, i + batchSize)
    const { error } = await supabase.from("tommy_award_ballots").insert(batch)

    if (error) {
      console.error("Insert error:", error)
      errors += batch.length
    } else {
      inserted += batch.length
      console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records`)
    }
  }

  console.log(`\nImport complete!`)
  console.log(`- Total parsed: ${rows.length}`)
  console.log(`- Inserted: ${inserted}`)
  console.log(`- Errors: ${errors}`)
}

importBallots().catch(console.error)
