"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { User, Mail, Phone, Building, MapPin, Camera, Save, Shield, Key, Calendar, Clock, Loader2 } from "lucide-react"
import { useUser, useDisplayName, useUserInitials } from "@/hooks/use-user" // Importing missing hooks

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
  { value: "Europe/London", label: "British Time (GMT/BST)" },
  { value: "Europe/Paris", label: "Central European Time (CET)" },
  { value: "Asia/Tokyo", label: "Japan Standard Time (JST)" },
  { value: "Australia/Sydney", label: "Australian Eastern Time (AET)" },
]

const DEPARTMENTS = ["Accounting", "Tax", "Advisory", "Client Services", "Operations", "Administration"]

export default function ProfileSettingsPage() {
  const { user, teamMember, isLoading: userLoading, refetch } = useUser()
  const displayName = useDisplayName()
  const initials = useUserInitials()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [teamMemberId, setTeamMemberId] = useState<string | null>(null)

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone_number: "",
    mobile_number: "",
    title: "",
    department: "",
    timezone: "",
  })

  // Auth form state
  const [authForm, setAuthForm] = useState({
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })

  const [isProfileSaving, setIsProfileSaving] = useState(false)
  const [isPasswordSaving, setIsPasswordSaving] = useState(false)
  const [isAvatarUploading, setIsAvatarUploading] = useState(false)

  useEffect(() => {
    if (teamMember?.id) {
      setTeamMemberId(teamMember.id)
    }
  }, [teamMember?.id])

  // Load team member data into form
  useEffect(() => {
    if (teamMember) {
      setProfileForm({
        first_name: teamMember.first_name || "",
        last_name: teamMember.last_name || "",
        email: teamMember.email || "",
        phone_number: teamMember.phone_number || "",
        mobile_number: teamMember.mobile_number || "",
        title: teamMember.title || "",
        department: teamMember.department || "",
        timezone: teamMember.timezone || "America/New_York",
      })
    }
    if (user) {
      setAuthForm((prev) => ({ ...prev, email: user.email || "" }))
    }
  }, [teamMember, user])

  const handleProfileChange = (field: string, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleAuthChange = (field: string, value: string) => {
    // Declaring missing function
    setAuthForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSaveProfile = async () => {
    const id = teamMember?.id || teamMemberId

    if (!id) {
      console.log("[v0] No team member ID available - teamMember:", teamMember, "teamMemberId state:", teamMemberId)
      toast({
        title: "Error",
        description: "Unable to identify your profile. Please refresh the page.",
        variant: "destructive",
      })
      return
    }

    setIsProfileSaving(true)
    try {
      console.log("[v0] Saving profile with ID:", id, "data:", profileForm)

      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamMemberId: id,
          ...profileForm,
          full_name: `${profileForm.first_name} ${profileForm.last_name}`.trim(),
        }),
      })

      const result = await response.json()
      console.log("[v0] Profile update response:", response.status, result)

      if (!response.ok) {
        throw new Error(result.error || "Failed to update profile")
      }

      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      })

      // Refresh user data
      refetch()
    } catch (error) {
      console.log("[v0] Profile update error:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update profile",
        variant: "destructive",
      })
    } finally {
      setIsProfileSaving(false)
    }
  }

  const handlePasswordChange = async () => {
    if (authForm.newPassword !== authForm.confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match",
        variant: "destructive",
      })
      return
    }

    if (authForm.newPassword.length < 8) {
      toast({
        title: "Error",
        description: "Password must be at least 8 characters",
        variant: "destructive",
      })
      return
    }

    setIsPasswordSaving(true)
    try {
      const response = await fetch("/api/profile/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPassword: authForm.newPassword,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to update password")
      }

      toast({
        title: "Password Updated",
        description: "Your password has been successfully changed.",
      })

      // Clear password fields
      setAuthForm((prev) => ({
        ...prev,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }))
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update password",
        variant: "destructive",
      })
    } finally {
      setIsPasswordSaving(false)
    }
  }

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !teamMember?.id) return

    // Validate file type and size
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Error",
        description: "Please select an image file",
        variant: "destructive",
      })
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Error",
        description: "Image must be less than 5MB",
        variant: "destructive",
      })
      return
    }

    setIsAvatarUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("teamMemberId", teamMember.id)

      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to upload avatar")
      }

      toast({
        title: "Avatar Updated",
        description: "Your profile picture has been updated.",
      })

      refetch()
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload avatar",
        variant: "destructive",
      })
    } finally {
      setIsAvatarUploading(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your personal information and account settings</p>
        </div>

        {/* Profile Card Header */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={teamMember?.avatar_url || undefined} alt={displayName} />
                  <AvatarFallback className="bg-[#6B745D] text-white text-2xl">{initials}</AvatarFallback>
                </Avatar>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAvatarUploading}
                  className="absolute bottom-0 right-0 p-2 bg-white rounded-full shadow-md border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {isAvatarUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
                  ) : (
                    <Camera className="h-4 w-4 text-gray-600" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-900">{displayName}</h2>
                <p className="text-sm text-gray-500">{teamMember?.title || "Team Member"}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="secondary" className="bg-[#8E9B79] text-white">
                    {teamMember?.role || "Staff"}
                  </Badge>
                  {teamMember?.department && <Badge variant="outline">{teamMember.department}</Badge>}
                  {teamMember?.is_active !== false && <Badge className="bg-green-100 text-green-800">Active</Badge>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Settings Tabs */}
        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="bg-white border">
            <TabsTrigger value="profile" className="data-[state=active]:bg-[#6B745D] data-[state=active]:text-white">
              <User className="h-4 w-4 mr-2" />
              Profile Information
            </TabsTrigger>
            <TabsTrigger value="security" className="data-[state=active]:bg-[#6B745D] data-[state=active]:text-white">
              <Shield className="h-4 w-4 mr-2" />
              Security
            </TabsTrigger>
          </TabsList>

          {/* Profile Information Tab */}
          <TabsContent value="profile" className="space-y-6">
            {/* Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-[#6B745D]" />
                  Personal Information
                </CardTitle>
                <CardDescription>Update your personal details and contact information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First Name</Label>
                    <Input
                      id="first_name"
                      value={profileForm.first_name}
                      onChange={(e) => handleProfileChange("first_name", e.target.value)}
                      placeholder="Enter your first name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name</Label>
                    <Input
                      id="last_name"
                      value={profileForm.last_name}
                      onChange={(e) => handleProfileChange("last_name", e.target.value)}
                      placeholder="Enter your last name"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      id="email"
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => handleProfileChange("email", e.target.value)}
                      placeholder="Enter your email"
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone_number">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="phone_number"
                        value={profileForm.phone_number}
                        onChange={(e) => handleProfileChange("phone_number", e.target.value)}
                        placeholder="(555) 123-4567"
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mobile_number">Mobile Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="mobile_number"
                        value={profileForm.mobile_number}
                        onChange={(e) => handleProfileChange("mobile_number", e.target.value)}
                        placeholder="(555) 987-6543"
                        className="pl-10"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Work Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-5 w-5 text-[#6B745D]" />
                  Work Information
                </CardTitle>
                <CardDescription>Your role and department details at Motta Financial</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Job Title</Label>
                    <div className="relative">
                      <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="title"
                        value={profileForm.title}
                        onChange={(e) => handleProfileChange("title", e.target.value)}
                        placeholder="e.g., Senior Accountant"
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Select
                      value={profileForm.department}
                      onValueChange={(value) => handleProfileChange("department", value)}
                    >
                      <SelectTrigger>
                        <Building className="h-4 w-4 mr-2 text-gray-400" />
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEPARTMENTS.map((dept) => (
                          <SelectItem key={dept} value={dept}>
                            {dept}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select
                    value={profileForm.timezone}
                    onValueChange={(value) => handleProfileChange("timezone", value)}
                  >
                    <SelectTrigger>
                      <MapPin className="h-4 w-4 mr-2 text-gray-400" />
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Read-only information */}
                <div className="border-t mt-4 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-gray-500">Role</Label>
                      <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                        <Shield className="h-4 w-4 text-gray-400" />
                        <span className="text-sm">{teamMember?.role || "Staff"}</span>
                      </div>
                      <p className="text-xs text-gray-400">Contact an admin to change your role</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-gray-500">Start Date</Label>
                      <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-sm">
                          {teamMember?.start_date ? new Date(teamMember.start_date).toLocaleDateString() : "Not set"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Save Button */}
            <div className="flex justify-end">
              <Button
                onClick={handleSaveProfile}
                disabled={isProfileSaving}
                className="bg-[#6B745D] hover:bg-[#5a6350] text-white"
              >
                {isProfileSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-[#6B745D]" />
                  Change Password
                </CardTitle>
                <CardDescription>Update your password to keep your account secure</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={authForm.newPassword}
                    onChange={(e) => handleAuthChange("newPassword", e.target.value)}
                    placeholder="Enter new password"
                  />
                  <p className="text-xs text-gray-500">Must be at least 8 characters</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={authForm.confirmPassword}
                    onChange={(e) => handleAuthChange("confirmPassword", e.target.value)}
                    placeholder="Confirm new password"
                  />
                </div>

                <Button
                  onClick={handlePasswordChange}
                  disabled={isPasswordSaving || !authForm.newPassword || !authForm.confirmPassword}
                  variant="outline"
                  className="border-[#6B745D] text-[#6B745D] hover:bg-[#6B745D] hover:text-white bg-transparent"
                >
                  {isPasswordSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Key className="mr-2 h-4 w-4" />
                      Update Password
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Account Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-[#6B745D]" />
                  Account Information
                </CardTitle>
                <CardDescription>Your Supabase authentication details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-500">Auth Email</Label>
                    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md">
                      <Mail className="h-4 w-4 text-gray-400" />
                      <span className="text-sm">{user?.email || "Not available"}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-500">User ID</Label>
                    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md">
                      <User className="h-4 w-4 text-gray-400" />
                      <span className="text-sm font-mono text-xs truncate">{user?.id || "Not available"}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-500">Last Sign In</Label>
                  <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-sm">
                      {user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "Not available"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
