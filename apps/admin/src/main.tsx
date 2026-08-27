import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import './index.css'
import App from './App.tsx'

const configuredBasePath = import.meta.env.VITE_APP_BASE_PATH || '/'
const routerBasename = `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          colorInfo: '#1677ff',
          colorLink: '#1677ff',
          borderRadius: 8,
          colorBgLayout: '#f3f5f9',
          colorTextBase: '#1f2937',
          colorBorderSecondary: '#eef0f4',
          boxShadowTertiary:
            '0 1px 2px 0 rgb(0 0 0 / 3%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 2%)',
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Layout: {
            siderBg: '#ffffff',
            headerBg: '#ffffff',
            headerHeight: 60,
            headerPadding: '0 24px',
            bodyBg: '#f3f5f9',
          },
          Menu: {
            itemBorderRadius: 8,
            itemMarginInline: 12,
            itemMarginBlock: 4,
            itemHeight: 42,
            subMenuItemBorderRadius: 8,
            itemSelectedBg: '#e6f4ff',
            itemSelectedColor: '#0958d9',
            itemHoverBg: '#f5f7fa',
            iconSize: 16,
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            headerSplitColor: 'transparent',
            headerBorderRadius: 0,
            rowHoverBg: '#f0f7ff',
            borderColor: '#eef0f4',
            cellPaddingBlock: 13,
            cellPaddingInline: 14,
            footerBg: '#f8fafc',
          },
          Card: {
            borderRadiusLG: 12,
            paddingLG: 20,
            boxShadowTertiary:
              '0 1px 2px 0 rgb(0 0 0 / 3%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 2%)',
          },
          Button: {
            controlHeight: 34,
            borderRadius: 8,
            primaryShadow: '0 2px 4px rgb(22 119 255 / 18%)',
          },
          Input: {
            controlHeight: 34,
          },
          Select: {
            controlHeight: 34,
          },
          Tabs: {
            itemSelectedColor: '#0958d9',
            inkBarColor: '#1677ff',
          },
          Modal: {
            borderRadiusLG: 12,
          },
          Pagination: {
            itemSize: 30,
          },
          Dropdown: {
            borderRadiusLG: 10,
          },
        },
      }}
    >
      <BrowserRouter basename={routerBasename}>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
