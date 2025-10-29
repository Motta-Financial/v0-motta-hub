import { NextResponse } from "next/server"

export async function GET() {
  try {
    console.log("[v0] Fetching Karbon users...")

    if (!process.env.KARBON_BEARER_TOKEN || !process.env.KARBON_ACCESS_KEY) {
      console.error("[v0] Missing Karbon credentials")
      return NextResponse.json({ error: "Missing Karbon API credentials" }, { status: 401 })
    }

    const response = await fetch("https://api.karbonhq.com/v3/Users", {
      headers: {
        Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
        AccessKey: process.env.KARBON_ACCESS_KEY,
      },
    })

    if (!response.ok) {
      console.error("[v0] Karbon API error:", response.status, response.statusText)
      throw new Error(`Karbon API error: ${response.status}`)
    }

    const data = await response.json()
    console.log("[v0] Received users data structure:", Object.keys(data))

    const usersArray = data.value || []
    console.log("[v0] Found", usersArray.length, "users")

    const allUsers = usersArray.map((user: any) => ({
      userKey: user.UserKey || user.MemberKey,
      fullName: user.FullName || `${user.FirstName || ""} ${user.LastName || ""}`.trim(),
      firstName: user.FirstName,
      lastName: user.LastName,
      email: user.EmailAddress || user.Email,
      title: user.Title || user.JobTitle,
      department: user.Department,
      isActive: user.IsActive !== false, // Default to true if not specified
      avatarUrl: user.AvatarUrl,
      phoneNumber: user.PhoneNumber || user.WorkPhone,
      mobileNumber: user.MobileNumber || user.Mobile,
      officeLocation: user.OfficeLocation || user.Office,
      startDate: user.StartDate,
      role: user.Role || user.UserRole,
      permissions: user.Permissions,
      lastLoginDate: user.LastLoginDate,
    }))

    console.log("[v0] Returning", allUsers.length, "users")
    return NextResponse.json(allUsers)
  } catch (error) {
    console.error("[v0] Error fetching Karbon users:", error)
    return NextResponse.json(
      { error: "Failed to fetch users", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
