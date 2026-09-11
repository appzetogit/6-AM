import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react"
import { authAPI, userAPI } from "@food/api"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const ProfileContext = createContext(null)
const USER_SESSION_PREFERENCE_KEYS = ["userVegMode", "food-under-250-filters"]

export function ProfileProvider({ children }) {
  const getAddressId = (address) => address?.id || address?._id || null
  const normalizeAddressLabel = (label) => {
    const normalized = String(label || "").trim().toLowerCase()
    if (normalized === "home") return "Home"
    if (normalized === "office" || normalized === "work") return "Office"
    return "Other"
  }
  const normalizeAddress = (address) => {
    if (!address || typeof address !== "object") return null
    const id = getAddressId(address)
    return {
      ...address,
      label: normalizeAddressLabel(address.label),
      ...(id ? { id: String(id) } : {}),
    }
  }
  const dedupeAddressesByLabel = (addressList = []) => {
    const addressMap = new Map()
    addressList.forEach((addr, index) => {
      const normalizedAddress = normalizeAddress(addr)
      if (!normalizedAddress) return
      const key = normalizedAddress.label || getAddressId(normalizedAddress) || index
      // Keep latest address for each label so newly saved Home/Work/Other is visible immediately
      addressMap.set(key, normalizedAddress)
    })
    return Array.from(addressMap.values())
  }
  const [userProfile, setUserProfile] = useState(() => {
    const userStr = localStorage.getItem("user_user")
    if (userStr) {
      try {
        return JSON.parse(userStr)
      } catch (e) {
        debugError("Error parsing user_user from localStorage:", e)
      }
    }
    const saved = localStorage.getItem("userProfile")
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        debugError("Error parsing userProfile from localStorage:", e)
      }
    }
    return null
  })
  
  const [loading, setLoading] = useState(true)

  const [addresses, setAddresses] = useState([])

  const [paymentMethods, setPaymentMethods] = useState(() => {
    const saved = localStorage.getItem("userPaymentMethods")
    return saved ? JSON.parse(saved) : []
  })

  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem("userFavorites")
    return saved ? JSON.parse(saved) : []
  })

  // Dish favorites state - stored in localStorage for persistence
  const [dishFavorites, setDishFavorites] = useState(() => {
    const saved = localStorage.getItem("userDishFavorites")
    return saved ? JSON.parse(saved) : []
  })

  // VegMode state - stored in localStorage for persistence
  const [vegMode, setVegMode] = useState(() => {
    const saved = localStorage.getItem("userVegMode")
    // Default to false (OFF) if not set
    return saved !== null ? saved === "true" : false
  })

  // Helper to check if authenticated
  const isAuthenticated = useMemo(() => {
    return localStorage.getItem("user_authenticated") === "true" || !!localStorage.getItem("user_accessToken")
  }, [userProfile])

  // Save to localStorage whenever userProfile, addresses or paymentMethods change
  useEffect(() => {
    if (userProfile || isAuthenticated) {
      localStorage.setItem("userProfile", JSON.stringify(userProfile))
    }
  }, [userProfile, isAuthenticated])

  useEffect(() => {
    if (addresses.length > 0 || isAuthenticated) {
      localStorage.setItem("userAddresses", JSON.stringify(addresses))
    }
  }, [addresses, isAuthenticated])

  useEffect(() => {
    if (paymentMethods.length > 0 || isAuthenticated) {
      localStorage.setItem("userPaymentMethods", JSON.stringify(paymentMethods))
    }
  }, [paymentMethods, isAuthenticated])

  useEffect(() => {
    if (favorites.length > 0 || isAuthenticated) {
      localStorage.setItem("userFavorites", JSON.stringify(favorites))
    }
  }, [favorites, isAuthenticated])

  useEffect(() => {
    if (dishFavorites.length > 0 || isAuthenticated) {
      localStorage.setItem("userDishFavorites", JSON.stringify(dishFavorites))
    }
  }, [dishFavorites, isAuthenticated])

  /**
   * Reconciles the wishlist with the server once the customer is signed in.
   *
   * Anything hearted as a guest is pushed up first — it was saved on this
   * device and signing in should not look like losing it — and the server's
   * list is then authoritative, because it is the one the phone will read.
   *
   * The slug is derived from the shop's name the same way every other screen
   * derives it; there is no stored slug to return.
   */
  useEffect(() => {
    if (!isAuthenticated) return undefined
    let cancelled = false

    const sync = async () => {
      try {
        const local = JSON.parse(localStorage.getItem("userDishFavorites") || "[]")
        const localIds = [...new Set(local.map((d) => String(d?.id || "")).filter(Boolean))]
        // Idempotent server-side, so pushing one that is already there is free.
        await Promise.allSettled(localIds.map((id) => userAPI.addFavoriteFood(id)))

        const res = await userAPI.getFavorites()
        if (cancelled) return
        const foods = res?.data?.data?.foods || []
        setDishFavorites(
          foods.map((f) => ({
            id: String(f._id),
            name: f.name,
            description: f.description,
            price: f.price,
            originalPrice: f.otherPrice,
            image: f.image || f.images?.[0] || "",
            restaurantId: String(f.restaurantId || ""),
            restaurantName: f.restaurantName || "",
            restaurantSlug: String(f.restaurantName || "").toLowerCase().replace(/\s+/g, "-"),
            foodType: f.foodType,
          })),
        )
      } catch (err) {
        // The locally held list stays on screen; a wishlist that cannot be
        // reached is not a reason to show the customer an empty one.
        debugError("wishlist sync failed", err)
      }
    }

    sync()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (isAuthenticated) {
      localStorage.setItem("userVegMode", vegMode.toString())
    }
  }, [vegMode, isAuthenticated])

  // Fetch user profile and addresses from API on mount and when authentication changes
  useEffect(() => {
    const fetchUserProfile = async () => {
      // Check if user is authenticated
      const isAuthenticated = localStorage.getItem("user_authenticated") === "true" || 
                             localStorage.getItem("user_accessToken")
      
      if (!isAuthenticated) {
        setUserProfile(null)
        setAddresses([])
        setPaymentMethods([])
        setFavorites([])
        setDishFavorites([])
        setVegMode(false)
        USER_SESSION_PREFERENCE_KEYS.forEach((key) => {
          localStorage.removeItem(key)
        })
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        
        // Fetch user profile
        const response = await authAPI.getCurrentUser()
        const userData = response?.data?.data?.user || response?.data?.user || response?.data
        
        if (userData) {
          setUserProfile(userData)
          // Update localStorage
          localStorage.setItem("user_user", JSON.stringify(userData))
          localStorage.setItem("userProfile", JSON.stringify(userData))
        }

        // Fetch addresses
        try {
          const addressesResponse = await userAPI.getAddresses()
          const addressesData = addressesResponse?.data?.data?.addresses || addressesResponse?.data?.addresses || []
          const normalizedAddresses = dedupeAddressesByLabel(addressesData)
          setAddresses(normalizedAddresses)
          localStorage.setItem("userAddresses", JSON.stringify(normalizedAddresses))
        } catch (addressError) {
          debugError("Error fetching addresses:", addressError)
          // Try to load from localStorage as fallback
          const saved = localStorage.getItem("userAddresses")
          if (saved) {
            try {
              setAddresses(dedupeAddressesByLabel(JSON.parse(saved)))
            } catch (e) {
              debugError("Error parsing saved addresses:", e)
            }
          }
        }
      } catch (error) {
        // Silently handle error - use existing profile from localStorage
        debugError("Error fetching user profile:", error)
        // Try to load from localStorage as fallback
        const saved = localStorage.getItem("userAddresses")
        if (saved) {
          try {
            setAddresses(dedupeAddressesByLabel(JSON.parse(saved)))
          } catch (e) {
            debugError("Error parsing saved addresses:", e)
          }
        }
      } finally {
        setLoading(false)
      }
    }

    fetchUserProfile()
    
    // Listen for auth changes
    const handleAuthChange = () => {
      fetchUserProfile()
    }
    
    window.addEventListener("userAuthChanged", handleAuthChange)
    
    return () => {
      window.removeEventListener("userAuthChanged", handleAuthChange)
    }
  }, [])

  // Address functions - memoized with useCallback
  const addAddress = useCallback(async (address) => {
    try {
      const response = await userAPI.addAddress(address)
      const newAddress = response?.data?.data?.address || response?.data?.address
      
      if (newAddress) {
        const normalizedNewAddress = normalizeAddress(newAddress)
        setAddresses((prev) => {
          const filtered = prev.filter(
            (addr) => normalizeAddressLabel(addr?.label) !== normalizeAddressLabel(normalizedNewAddress?.label)
          )
          const updated = dedupeAddressesByLabel([...filtered, normalizedNewAddress])
          localStorage.setItem("userAddresses", JSON.stringify(updated))
          return updated
        })
        return normalizedNewAddress
      }
    } catch (error) {
      debugError("Error adding address:", error)
      throw error
    }
  }, [])

  const updateAddress = useCallback(async (id, updatedAddress) => {
    try {
      const response = await userAPI.updateAddress(id, updatedAddress)
      const updatedAddr = response?.data?.data?.address || response?.data?.address
      
      if (updatedAddr) {
        const normalizedUpdatedAddress = normalizeAddress(updatedAddr)
        setAddresses((prev) => {
          const updated = dedupeAddressesByLabel(
            prev.map((addr) => (String(getAddressId(addr)) === String(id) ? normalizedUpdatedAddress : normalizeAddress(addr)))
          )
          localStorage.setItem("userAddresses", JSON.stringify(updated))
          return updated
        })
        return normalizedUpdatedAddress
      }
    } catch (error) {
      debugError("Error updating address:", error)
      throw error
    }
  }, [])

  const deleteAddress = useCallback(async (id) => {
    try {
      await userAPI.deleteAddress(id)
      setAddresses((prev) => {
        const newAddresses = prev.filter((addr) => String(getAddressId(addr)) !== String(id))
        localStorage.setItem("userAddresses", JSON.stringify(newAddresses))
        return newAddresses
      })
    } catch (error) {
      debugError("Error deleting address:", error)
      throw error
    }
  }, [])

  const setDefaultAddress = useCallback(async (id) => {
    // Optimistic UI update first
    setAddresses((prev) =>
      prev.map((addr) => ({
        ...addr,
        isDefault: String(getAddressId(addr)) === String(id),
      }))
    )

    try {
      await userAPI.setDefaultAddress(id)
    } catch (error) {
      debugError("Error setting default address:", error)
      // Keep UI stable even if backend call fails
    }
  }, [])

  const getDefaultAddress = useCallback(() => {
    return addresses.find((addr) => addr.isDefault) || addresses[0] || null
  }, [addresses])

  // Payment method functions - memoized with useCallback
  const addPaymentMethod = useCallback((payment) => {
    setPaymentMethods((prev) => {
      const newPayment = {
        ...payment,
        id: Date.now().toString(),
        isDefault: prev.length === 0 ? true : false,
      }
      return [...prev, newPayment]
    })
  }, [])

  const updatePaymentMethod = useCallback((id, updatedPayment) => {
    setPaymentMethods((prev) =>
      prev.map((pm) => (pm.id === id ? { ...pm, ...updatedPayment } : pm))
    )
  }, [])

  const deletePaymentMethod = useCallback((id) => {
    setPaymentMethods((prev) => {
      const paymentToDelete = prev.find((pm) => pm.id === id)
      const newPayments = prev.filter((pm) => pm.id !== id)
      
      // If deleting default, set first remaining as default
      if (paymentToDelete?.isDefault && newPayments.length > 0) {
        newPayments[0].isDefault = true
      }
      
      return newPayments
    })
  }, [])

  const setDefaultPaymentMethod = useCallback((id) => {
    setPaymentMethods((prev) =>
      prev.map((pm) => ({
        ...pm,
        isDefault: pm.id === id,
      }))
    )
  }, [])

  const getDefaultPaymentMethod = useCallback(() => {
    return paymentMethods.find((pm) => pm.isDefault) || paymentMethods[0] || null
  }, [paymentMethods])

  const getAddressById = useCallback((id) => {
    return addresses.find((addr) => String(getAddressId(addr)) === String(id))
  }, [addresses])

  const getPaymentMethodById = useCallback((id) => {
    return paymentMethods.find((pm) => pm.id === id)
  }, [paymentMethods])

  // Favorites functions - memoized with useCallback
  const addFavorite = useCallback((restaurant) => {
    setFavorites((prev) => {
      if (!prev.find(fav => fav.slug === restaurant.slug)) {
        return [...prev, restaurant]
      }
      return prev
    })
  }, [])

  const removeFavorite = useCallback((slug) => {
    setFavorites((prev) => prev.filter(fav => fav.slug !== slug))
  }, [])

  const isFavorite = useCallback((slug) => {
    return favorites.some(fav => fav.slug === slug)
  }, [favorites])

  const getFavorites = useCallback(() => {
    return favorites
  }, [favorites])

  /**
   * The product wishlist, kept on the server for a signed-in customer.
   *
   * It used to live only in localStorage, so it died with the browser's site
   * data and never reached the same customer's phone — while the API that was
   * meant to hold it sat unused.
   *
   * Writes are optimistic and roll back if the server refuses: the heart has to
   * fill the instant it is tapped, and a wishlist is not worth blocking a tap
   * on a round trip. A guest still gets localStorage, and what they saved
   * before signing in is pushed up on the way in rather than dropped.
   */
  const addDishFavorite = useCallback((dish) => {
    let added = false
    setDishFavorites((prev) => {
      if (prev.find((fav) => fav.id === dish.id && fav.restaurantId === dish.restaurantId)) return prev
      added = true
      return [...prev, dish]
    })
    if (!added || !isAuthenticated) return
    userAPI.addFavoriteFood(dish.id).catch((err) => {
      debugError("wishlist add failed", err)
      setDishFavorites((prev) => prev.filter((f) => !(f.id === dish.id && f.restaurantId === dish.restaurantId)))
    })
  }, [isAuthenticated])

  const removeDishFavorite = useCallback((dishId, restaurantId) => {
    let removed = null
    setDishFavorites((prev) => {
      removed = prev.find((f) => f.id === dishId && f.restaurantId === restaurantId) || null
      return prev.filter((fav) => !(fav.id === dishId && fav.restaurantId === restaurantId))
    })
    if (!removed || !isAuthenticated) return
    userAPI.removeFavoriteFood(dishId).catch((err) => {
      debugError("wishlist remove failed", err)
      setDishFavorites((prev) => (prev.some((f) => f.id === dishId) ? prev : [...prev, removed]))
    })
  }, [isAuthenticated])

  const isDishFavorite = useCallback((dishId, restaurantId) => {
    return dishFavorites.some(fav => fav.id === dishId && fav.restaurantId === restaurantId)
  }, [dishFavorites])

  const getDishFavorites = useCallback(() => {
    return dishFavorites
  }, [dishFavorites])

  // User profile functions - memoized with useCallback
  const updateUserProfile = useCallback((updatedProfile) => {
    setUserProfile((prev) => ({ ...prev, ...updatedProfile }))
  }, [])

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(
    () => ({
      userProfile,
      loading,
      updateUserProfile,
      addresses,
      paymentMethods,
      favorites,
      vegMode,
      setVegMode,
      addAddress,
      updateAddress,
      deleteAddress,
      setDefaultAddress,
      getDefaultAddress,
      getAddressById,
      addPaymentMethod,
      updatePaymentMethod,
      deletePaymentMethod,
      setDefaultPaymentMethod,
      getDefaultPaymentMethod,
      getPaymentMethodById,
      addFavorite,
      removeFavorite,
      isFavorite,
      getFavorites,
      dishFavorites,
      addDishFavorite,
      removeDishFavorite,
      isDishFavorite,
      getDishFavorites,
    }),
    [
      userProfile,
      loading,
      updateUserProfile,
      addresses,
      paymentMethods,
      favorites,
      dishFavorites,
      vegMode,
      setVegMode,
      addAddress,
      updateAddress,
      deleteAddress,
      setDefaultAddress,
      getDefaultAddress,
      getAddressById,
      addPaymentMethod,
      updatePaymentMethod,
      deletePaymentMethod,
      setDefaultPaymentMethod,
      getDefaultPaymentMethod,
      getPaymentMethodById,
      addFavorite,
      removeFavorite,
      isFavorite,
      getFavorites,
      addDishFavorite,
      removeDishFavorite,
      isDishFavorite,
      getDishFavorites,
    ]
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const context = useContext(ProfileContext)
  if (!context) {
    // Return fallback values instead of throwing error
    // This prevents crashes when ProfileProvider is not available
    debugWarn("useProfile called outside ProfileProvider - using fallback values")
    return {
      userProfile: null,
      loading: false,
      updateUserProfile: () => debugWarn("ProfileProvider not available"),
      addresses: [],
      paymentMethods: [],
      favorites: [],
      addAddress: () => debugWarn("ProfileProvider not available"),
      updateAddress: () => debugWarn("ProfileProvider not available"),
      deleteAddress: () => debugWarn("ProfileProvider not available"),
      setDefaultAddress: () => debugWarn("ProfileProvider not available"),
      getDefaultAddress: () => null,
      getAddressById: () => null,
      addPaymentMethod: () => debugWarn("ProfileProvider not available"),
      updatePaymentMethod: () => debugWarn("ProfileProvider not available"),
      deletePaymentMethod: () => debugWarn("ProfileProvider not available"),
      setDefaultPaymentMethod: () => debugWarn("ProfileProvider not available"),
      getDefaultPaymentMethod: () => null,
      getPaymentMethodById: () => null,
      addFavorite: () => debugWarn("ProfileProvider not available"),
      removeFavorite: () => debugWarn("ProfileProvider not available"),
      isFavorite: () => false,
      getFavorites: () => [],
      dishFavorites: [],
      addDishFavorite: () => debugWarn("ProfileProvider not available"),
      removeDishFavorite: () => debugWarn("ProfileProvider not available"),
      isDishFavorite: () => false,
      getDishFavorites: () => [],
      vegMode: false,
      setVegMode: () => debugWarn("ProfileProvider not available")
    }
  }
  return context
}


