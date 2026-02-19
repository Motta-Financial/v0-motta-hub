"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageSquare, ExternalLink, Users, Video } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export function TeamsChat() {
  const [isConnected, setIsConnected] = useState(false)

  const handleConnectTeams = () => {
    // TODO: Implement Microsoft Teams OAuth authentication
    // This will use Microsoft Graph API to authenticate and access Teams chat
    console.log("[v0] Initiating Teams authentication...")
    setIsConnected(true)
  }

  return (
    <Card className="bg-white shadow-sm border-gray-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              Microsoft Teams Chat
            </CardTitle>
            <CardDescription>Connect with your team directly from the dashboard</CardDescription>
          </div>
          {isConnected && (
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <div className="text-center py-8">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Connect Microsoft Teams</h3>
            <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto">
              Access your Teams chats, channels, and meetings directly from Motta Hub. Stay connected with your team
              without switching apps.
            </p>
            <Button onClick={handleConnectTeams} className="bg-blue-600 hover:bg-blue-700">
              <MessageSquare className="h-4 w-4 mr-2" />
              Connect to Teams
            </Button>
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <div>
                <MessageSquare className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <p className="text-xs text-gray-600">Chat & Channels</p>
              </div>
              <div>
                <Users className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <p className="text-xs text-gray-600">Team Collaboration</p>
              </div>
              <div>
                <Video className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <p className="text-xs text-gray-600">Quick Meetings</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <p className="text-sm text-gray-600 mb-3">Recent Conversations</p>
              <div className="text-center py-4">
                <MessageSquare className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Your Teams conversations will appear here.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 bg-transparent" size="sm">
                <MessageSquare className="h-4 w-4 mr-2" />
                Open Teams Chat
              </Button>
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
