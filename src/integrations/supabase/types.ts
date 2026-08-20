export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          id: string
          business_id: string
          slug: string
          customer_name: string | null
          customer_phone: string | null
          messages: Json
          had_order: boolean
          order_data: Json | null
          source: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          slug: string
          customer_name?: string | null
          customer_phone?: string | null
          messages?: Json
          had_order?: boolean
          order_data?: Json | null
          source?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          slug?: string
          customer_name?: string | null
          customer_phone?: string | null
          messages?: Json
          had_order?: boolean
          order_data?: Json | null
          source?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      businesses: {
        Row: {
          address: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          owner_id: string
          plan: string
          plan_expires_at: string | null
          plan_started_at: string | null
          primary_color: string | null
          slug: string
          updated_at: string
          wa_access_token: string | null
          wa_phone_number_id: string | null
          whatsapp_number: string
          ai_enabled: boolean
          ai_prompt: string | null
          ai_auto_reply_mode: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          owner_id: string
          plan?: string
          plan_expires_at?: string | null
          plan_started_at?: string | null
          primary_color?: string | null
          slug: string
          updated_at?: string
          wa_access_token?: string | null
          wa_phone_number_id?: string | null
          whatsapp_number: string
          ai_enabled?: boolean
          ai_prompt?: string | null
          ai_auto_reply_mode?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          owner_id?: string
          plan?: string
          plan_expires_at?: string | null
          plan_started_at?: string | null
          primary_color?: string | null
          slug?: string
          updated_at?: string
          wa_access_token?: string | null
          wa_phone_number_id?: string | null
          whatsapp_number?: string
          ai_enabled?: boolean
          ai_prompt?: string | null
          ai_auto_reply_mode?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          business_id: string
          name: string
          phone: string | null
          email: string | null
          notes: string | null
          is_active: boolean
          total_orders: number
          last_order_at: string | null
          created_at: string
          tags: string[]
          address: string | null
        }
        Insert: {
          id?: string
          business_id: string
          name: string
          phone?: string | null
          email?: string | null
          notes?: string | null
          is_active?: boolean
          total_orders?: number
          last_order_at?: string | null
          created_at?: string
          tags?: string[]
          address?: string | null
        }
        Update: {
          id?: string
          business_id?: string
          name?: string
          phone?: string | null
          email?: string | null
          notes?: string | null
          is_active?: boolean
          total_orders?: number
          last_order_at?: string | null
          created_at?: string
          tags?: string[]
          address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          business_id: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          position: number
        }
        Insert: {
          business_id: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          position?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          id: string
          order_id: string
          from_status: string
          to_status: string
          changed_at: string
          note: string | null
        }
        Insert: {
          id?: string
          order_id: string
          from_status: string
          to_status: string
          changed_at?: string
          note?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          from_status?: string
          to_status?: string
          changed_at?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          product_price: number
          quantity: number
          subtotal: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          product_price: number
          quantity?: number
          subtotal: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          product_price?: number
          quantity?: number
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          business_id: string
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          delivery_type: string
          delivery_address: string | null
          id: string
          notes: string | null
          status: string
          total: number
          updated_at: string
          whatsapp_sent_at: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          delivery_type?: string
          delivery_address?: string | null
          id?: string
          notes?: string | null
          status?: string
          total: number
          updated_at?: string
          whatsapp_sent_at?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          delivery_type?: string
          delivery_address?: string | null
          id?: string
          notes?: string | null
          status?: string
          total?: number
          updated_at?: string
          whatsapp_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_pricing: {
        Row: {
          description: string | null
          id: string
          is_active: boolean
          label: string
          max_orders_monthly: number | null
          max_products: number | null
          price_monthly: number
          updated_at: string
        }
        Insert: {
          description?: string | null
          id: string
          is_active?: boolean
          label: string
          max_orders_monthly?: number | null
          max_products?: number | null
          price_monthly?: number
          updated_at?: string
        }
        Update: {
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
          max_orders_monthly?: number | null
          max_products?: number | null
          price_monthly?: number
          updated_at?: string
        }
        Relationships: []
      }
      product_toppings: {
        Row: {
          id: string
          product_id: string
          topping_id: string
        }
        Insert: {
          id?: string
          product_id: string
          topping_id: string
        }
        Update: {
          id?: string
          product_id?: string
          topping_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_toppings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_toppings_topping_id_fkey"
            columns: ["topping_id"]
            isOneToOne: false
            referencedRelation: "toppings"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          business_id: string
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean
          name: string
          position: number
          price: number
          updated_at: string
          uses_toppings: boolean
          uses_flavors: boolean
          allows_half_half: boolean
        }
        Insert: {
          business_id: string
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name: string
          position?: number
          price: number
          updated_at?: string
          uses_toppings?: boolean
          uses_flavors?: boolean
          allows_half_half?: boolean
        }
        Update: {
          business_id?: string
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name?: string
          position?: number
          price?: number
          updated_at?: string
          uses_toppings?: boolean
          uses_flavors?: boolean
          allows_half_half?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      toppings: {
        Row: {
          business_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          position: number
          price: number
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          position?: number
          price?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "toppings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_contacts: {
        Row: {
          id: string
          business_id: string
          phone: string
          name: string | null
          status: string
          tags: string[]
          score: number
          notes: string | null
          last_interaction_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          phone: string
          name?: string | null
          status?: string
          tags?: string[]
          score?: number
          notes?: string | null
          last_interaction_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          phone?: string
          name?: string | null
          status?: string
          tags?: string[]
          score?: number
          notes?: string | null
          last_interaction_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_conversations: {
        Row: {
          id: string
          business_id: string
          contact_id: string
          status: string
          unread_count: number
          last_message_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          contact_id: string
          status?: string
          unread_count?: number
          last_message_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          contact_id?: string
          status?: string
          unread_count?: number
          last_message_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_conversations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_messages: {
        Row: {
          id: string
          business_id: string
          conversation_id: string
          contact_id: string
          wa_message_id: string | null
          direction: string
          type: string
          content: string | null
          media_url: string | null
          intent: string | null
          sent_by_ai: boolean
          status: string
          wa_timestamp: string | null
          created_at: string
        }
        Insert: {
          id?: string
          business_id: string
          conversation_id: string
          contact_id: string
          wa_message_id?: string | null
          direction: string
          type?: string
          content?: string | null
          media_url?: string | null
          intent?: string | null
          sent_by_ai?: boolean
          status?: string
          wa_timestamp?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          conversation_id?: string
          contact_id?: string
          wa_message_id?: string | null
          direction?: string
          type?: string
          content?: string | null
          media_url?: string | null
          intent?: string | null
          sent_by_ai?: boolean
          status?: string
          wa_timestamp?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_bulk_jobs: {
        Row: {
          id: string
          business_id: string
          name: string
          message: string
          filter_type: string
          filter_value: string | null
          status: string
          total_count: number
          sent_count: number
          delivered_count: number
          failed_count: number
          scheduled_at: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          business_id: string
          name: string
          message: string
          filter_type?: string
          filter_value?: string | null
          status?: string
          total_count?: number
          sent_count?: number
          delivered_count?: number
          failed_count?: number
          scheduled_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          name?: string
          message?: string
          filter_type?: string
          filter_value?: string | null
          status?: string
          total_count?: number
          sent_count?: number
          delivered_count?: number
          failed_count?: number
          scheduled_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      wa_bulk_job_items: {
        Row: {
          id: string
          job_id: string
          business_id: string
          contact_id: string
          phone: string
          name: string | null
          status: string
          wa_message_id: string | null
          error_msg: string | null
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          job_id: string
          business_id: string
          contact_id: string
          phone: string
          name?: string | null
          status?: string
          wa_message_id?: string | null
          error_msg?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          job_id?: string
          business_id?: string
          contact_id?: string
          phone?: string
          name?: string | null
          status?: string
          wa_message_id?: string | null
          error_msg?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      wa_followup_rules: {
        Row: {
          id: string
          business_id: string
          name: string
          trigger_event: string
          trigger_condition: Json
          delay_hours: number
          message_template: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          name: string
          trigger_event: string
          trigger_condition?: import('./types').Json
          delay_hours?: number
          message_template: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          name?: string
          trigger_event?: string
          trigger_condition?: import('./types').Json
          delay_hours?: number
          message_template?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_followup_instances: {
        Row: {
          id: string
          rule_id: string | null
          business_id: string
          contact_id: string | null
          phone: string
          name: string | null
          message: string
          scheduled_at: string
          status: string
          sent_at: string | null
          wa_message_id: string | null
          error_msg: string | null
          created_at: string
        }
        Insert: {
          id?: string
          rule_id?: string | null
          business_id: string
          contact_id?: string | null
          phone: string
          name?: string | null
          message: string
          scheduled_at?: string
          status?: string
          sent_at?: string | null
          wa_message_id?: string | null
          error_msg?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          rule_id?: string | null
          business_id?: string
          contact_id?: string | null
          phone?: string
          name?: string | null
          message?: string
          scheduled_at?: string
          status?: string
          sent_at?: string | null
          wa_message_id?: string | null
          error_msg?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
