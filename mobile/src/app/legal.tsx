// Tempo — in-app Privacy Policy & Terms.
//
// The App Store (Guideline 5.1.1) requires a privacy policy that's accessible from
// within the app, not just a URL buried in metadata. Keeping it in-app means it
// always resolves for the reviewer (no dependency on a marketing site being live).
// This is a plain-language summary of what Tempo actually collects and does; have it
// reviewed by counsel before public launch and mirror it at your privacy URL.

import { useRef } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius } from '@/constants/theme'
import { BRAND_NAME, BRAND_SUPPORT_EMAIL } from '@/constants/brand'
import {
  PRIVACY_SECTIONS, TERMS_SECTIONS, LEGAL_UPDATED,
  type LegalSection, type LegalBlock,
} from '@/constants/legalContent'
import { fillLegalText } from '@/lib/storeCopy'
import { useTheme, useThemedStyles, type Palette } from '@/theme'


const UPDATED = LEGAL_UPDATED
const SUPPORT_EMAIL = BRAND_SUPPORT_EMAIL

/** Placeholders live in the content module so a brand rename can't strand a
 *  stale name inside a legal document; the substitution itself lives in
 *  lib/storeCopy so the store-specific half is unit-tested. */
const fill = fillLegalText

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  )
}
function P({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles)
  return <Text style={styles.p}>{children}</Text>
}
function Bullet({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  )
}

function Blocks({ blocks }: { blocks: LegalBlock[] }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <>
      {blocks.map((b, i) => {
        if (b.sub) return <Text key={i} style={styles.sub}>{fill(b.sub)}</Text>
        if (b.bullets) return <View key={i}>{b.bullets.map((t, j) => <Bullet key={j}>{fill(t)}</Bullet>)}</View>
        return <P key={i}>{fill(b.p ?? '')}</P>
      })}
    </>
  )
}

function Document({ sections }: { sections: LegalSection[] }) {
  return (
    <>
      {sections.map((sec) => (
        <Section key={sec.title} title={fill(sec.title)}>
          <Blocks blocks={sec.blocks} />
        </Section>
      ))}
    </>
  )
}

// App Review checks that a subscription screen's Terms and Privacy links lead
// somewhere distinguishably different — this is one screen (there's no reason
// to duplicate the whole legal document into two routes), but a `section`
// param now actually scrolls to the tapped section instead of both links
// landing on the identical top-of-document view.
export default function LegalScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { section } = useLocalSearchParams<{ section?: 'privacy' | 'terms' }>()
  const scrollRef = useRef<ScrollView>(null)
  const scrolledRef = useRef(false)

  const onTermsLayout = (e: LayoutChangeEvent) => {
    if (section !== 'terms' || scrolledRef.current) return
    scrolledRef.current = true
    scrollRef.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: true })
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={section === 'terms' ? 'Terms of Use' : section === 'privacy' ? 'Privacy Policy' : 'Privacy & Terms'}
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Privacy Policy</Text>
        <Text style={styles.updated}>Last updated {UPDATED}</Text>
        <Document sections={PRIVACY_SECTIONS} />

        <View style={styles.divider} />

        <View onLayout={onTermsLayout}>
          <Text style={styles.h1}>Terms of Use</Text>
          <Text style={styles.updated}>Last updated {UPDATED}</Text>
        </View>
        <Document sections={TERMS_SECTIONS} />

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl },

  h1: { fontFamily: C.fontDisplay, fontSize: 26, color: C.text, letterSpacing: -0.4, marginTop: Spacing.sm },
  updated: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, marginTop: 2, marginBottom: Spacing.sm },

  section: { marginTop: Spacing.md },
  h2: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, marginBottom: Spacing.xs, letterSpacing: -0.1 },
  sub: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: C.text, marginTop: Spacing.sm, marginBottom: 2 },
  p: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 21 },

  bulletRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: 6 },
  bulletDot: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary, lineHeight: 21 },
  bulletText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 21 },

  divider: { height: 1, backgroundColor: C.outlineVariant, marginVertical: Spacing.lg },
})
